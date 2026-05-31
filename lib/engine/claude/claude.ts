import { homedir } from "node:os"
import { join } from "node:path"
import type { FunnelChannels } from "@/engine/channels/channels"
import type { GatewayController } from "@/engine/claude/gateway-controller"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelIdGenerator } from "@/engine/id/id-generator"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelMcp } from "@/engine/mcp/mcp"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import type { FunnelProfiles } from "@/engine/profiles/profiles"
import { FUNNEL_DIR, resolveFunnelPort } from "@/engine/settings/settings-store"

export type LaunchOptions = {
  channel: string
  cwd?: string
  userArgs?: string[]
  /** Stable id of the launching profile (uuid). Keys the singleton PID file and
   *  the resumable session. Absent for a profile-less launch (raw `--channel`),
   *  which never enforces singleton-ness and never resumes. */
  profileId?: string
  /** Args prepended to the claude argv (typically a profile's recipe). Defaults to none. */
  options?: string[]
  /** Env vars layered under the launched claude process. process.env wins on collision. */
  env?: Record<string, string>
  /** Whether to inject a `--session-id`/`--resume` for this profile.
   *  Defaults to false: resuming is opt-in and only meaningful for a profile,
   *  since the persisted session is owned by the profile (by id). A launch
   *  without a profile always starts a fresh session regardless of this flag. */
  resume?: boolean
  /** Invoked synchronously after the child claude process has been spawned, with its PID.
   *  Useful for hosts that need to register the spawned process before it exits
   *  (e.g. multi-session registries that track per-claude liveness). */
  onSpawned?: (pid: number) => void
  /** Whether to install the funnel MCP entry into `.mcp.json` (default: true).
   *  Set to false when the host already provides its own MCP server entry and
   *  does not need the funnel binary as an MCP endpoint. */
  installMcp?: boolean
}

type SessionResolution = { id: string; mode: "resume" | "new" } | null

type Deps = {
  channels: FunnelChannels
  mcp: FunnelMcp
  gateway: GatewayController
  profiles: FunnelProfiles
  process?: FunnelProcessRunner
  fs?: FunnelFileSystem
  idGenerator?: FunnelIdGenerator
  logger?: FunnelLogger
  dir?: string
}

const defaultProcess = new NodeFunnelProcessRunner()
const defaultFs = new NodeFunnelFileSystem()
const defaultIdGenerator = new NodeFunnelIdGenerator()

/**
 * Launches Claude Code with funnel pre-wired: ensures the gateway is running,
 * installs the funnel MCP into the target repo's `.mcp.json` if missing,
 * injects `FUNNEL_CHANNEL_ID` into the child env, and writes a per-profile
 * PID file to enforce singleton launches.
 */
export class FunnelClaude {
  private readonly channels: FunnelChannels
  private readonly mcp: FunnelMcp
  private readonly gateway: GatewayController
  private readonly profiles: FunnelProfiles
  private readonly process: FunnelProcessRunner
  private readonly fs: FunnelFileSystem
  private readonly idGenerator: FunnelIdGenerator
  private readonly logger: FunnelLogger | undefined
  private readonly pidDir: string

  constructor(deps: Deps) {
    this.channels = deps.channels
    this.mcp = deps.mcp
    this.gateway = deps.gateway
    this.profiles = deps.profiles
    this.process = deps.process ?? defaultProcess
    this.fs = deps.fs ?? defaultFs
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator
    this.logger = deps.logger
    this.pidDir = join(deps.dir ?? FUNNEL_DIR, "claude")
    Object.freeze(this)
  }

  async launch(options: LaunchOptions): Promise<number> {
    const channel = this.channels.get(options.channel) ?? this.channels.getById(options.channel)

    if (!channel) {
      throw new Error(`channel "${options.channel}" not found`)
    }

    if (options.profileId && this.isRunning(options.profileId)) {
      throw new Error(`profile "${options.profileId}" is already running`)
    }

    const cwd = options.cwd ?? globalThis.process.cwd()
    const installMcp = options.installMcp ?? true

    if (installMcp && !this.mcp.findInstalledName(cwd)) {
      this.mcp.install(cwd)

      this.logger?.info(`added funnel MCP to .mcp.json`, { cwd })
    }

    if (!this.gateway.isRunning()) {
      this.logger?.info(`starting gateway automatically`)
      await this.gateway.start()
    }

    if (options.profileId) {
      this.writePidFile(options.profileId)
      this.installCleanup(options.profileId)
    }

    const resume = options.resume ?? false
    const session =
      resume && options.profileId
        ? this.resolveSession(
            options.profileId,
            cwd,
            options.userArgs ?? [],
            options.env ?? {},
          )
        : null
    const claudeArgs = this.buildArgs(options.options ?? [], options.userArgs ?? [], cwd, session)
    const env = this.buildEnv(channel.id, options.env ?? {})

    this.logger?.info(`claude launch`, {
      channel: options.channel,
      channelId: channel.id,
      cwd,
    })

    try {
      return await this.process.attach(["claude", ...claudeArgs], {
        cwd,
        env,
        onSpawned: options.onSpawned,
      })
    } finally {
      if (options.profileId) this.removePidFile(options.profileId)
    }
  }

  isRunning(profileId: string): boolean {
    const pid = this.readPid(profileId)

    if (!pid) return false

    return this.isProcessAlive(pid)
  }

  private pidPath(profileId: string): string {
    return join(this.pidDir, `${profileId}.pid`)
  }

  private readPid(profileId: string): number | null {
    const path = this.pidPath(profileId)

    if (!this.fs.existsSync(path)) return null

    try {
      const content = this.fs.readFileSync(path).trim()
      const pid = Number(content)

      if (!pid || pid <= 0) return null

      return pid
    } catch {
      return null
    }
  }

  private writePidFile(profileId: string): void {
    this.fs.mkdirSync(this.pidDir, { recursive: true })
    this.fs.writeFileSync(this.pidPath(profileId), String(globalThis.process.pid))
  }

  private removePidFile(profileId: string): void {
    const path = this.pidPath(profileId)

    if (this.fs.existsSync(path)) this.fs.unlink(path)
  }

  private installCleanup(profileId: string): void {
    // Default Bun behavior on SIGINT/SIGTERM is process.exit(130/143), which
    // fires the "exit" event. Hooking only "exit" keeps the PID file cleanup
    // running while letting the signal terminate the process normally —
    // adding our own SIGINT handler would suppress the default exit and leave
    // funnel hanging until claude responds.
    globalThis.process.once("exit", () => this.removePidFile(profileId))
  }

  private isProcessAlive(pid: number): boolean {
    return this.process.isAlive(pid)
  }

  private buildArgs(
    recipeOptions: string[],
    userArgs: string[],
    cwd: string,
    session: SessionResolution,
  ): string[] {
    const result = [...recipeOptions, ...userArgs]

    if (session !== null) {
      // claude rejects `--session-id <uuid>` when the session jsonl already
      // exists, so resuming an existing session has to go through `--resume`.
      if (session.mode === "resume") {
        result.push("--resume", session.id)
      } else {
        result.push("--session-id", session.id)
      }
    }

    const mcpName = this.mcp.findInstalledName(cwd)

    if (
      mcpName &&
      !result.includes("--dangerously-load-development-channels") &&
      !result.includes("--channels")
    ) {
      result.push("--dangerously-load-development-channels", `server:${mcpName}`)
    }

    return result
  }

  /**
   * Decides whether funnel should resume an existing claude session or start
   * a freshly minted one. Backs off when the user already passed a
   * session-shaping flag, since combining them would either confuse claude
   * or override the explicit user intent.
   *
   * The session is owned by the profile (by id), not by cwd: two profiles
   * pointing at the same repo each keep their own conversation, and a launch
   * with no profile never resumes — so an unrelated session in the same repo
   * can't bleed in. The channel never enters into it; sessions belong to the
   * launch layer (profiles), keeping the transport layer ignorant of them.
   *
   * A persisted id is only resumed when its session jsonl still exists on
   * disk. claude errors out on `--resume <id>` for a missing conversation, and
   * a persisted id can outlive its jsonl (claude pruned it, or the very first
   * launch was aborted after the id was written but before the jsonl
   * appeared). When the file is gone we mint a fresh session instead, which
   * overwrites the dangling entry — so the store self-heals.
   */
  private resolveSession(
    profileId: string,
    cwd: string,
    userArgs: string[],
    recipeEnv: Record<string, string>,
  ): SessionResolution {
    for (const arg of userArgs) {
      if (arg === "-c" || arg === "--continue") return null
      if (arg === "--resume" || arg.startsWith("--resume=")) return null
      if (arg === "--session-id" || arg.startsWith("--session-id=")) return null
    }

    const existing = this.profiles.getSessionId(profileId)

    if (existing !== null && this.sessionFileExists(cwd, existing, recipeEnv)) {
      return { id: existing, mode: "resume" }
    }

    const fresh = this.idGenerator.generate()

    this.profiles.setSessionId(profileId, fresh)

    return { id: fresh, mode: "new" }
  }

  /**
   * Mirrors claude's session storage path
   * (`<config-dir>/projects/<cwd-with-slashes-as-dashes>/<id>.jsonl`) to check
   * whether a recorded session still exists AND is non-empty. Reads the same
   * `CLAUDE_CONFIG_DIR` the child will run under so the check matches reality; a
   * wrong guess can only ever produce a false negative (start fresh), never a
   * bad resume.
   */
  private sessionFileExists(
    cwd: string,
    sessionId: string,
    recipeEnv: Record<string, string>,
  ): boolean {
    const configDir =
      recipeEnv.CLAUDE_CONFIG_DIR ??
      globalThis.process.env.CLAUDE_CONFIG_DIR ??
      join(homedir(), ".claude")
    const projectSlug = cwd.replace(/\//g, "-")
    const path = join(configDir, "projects", projectSlug, `${sessionId}.jsonl`)

    if (!this.fs.existsSync(path)) return false

    // An empty / whitespace-only jsonl is a corrupt session that claude rejects
    // with "No conversation found"; treat it as missing so the launch resolves a
    // fresh session instead of a doomed --resume.
    return this.fs.readFileSync(path).trim().length > 0
  }

  private buildEnv(channelId: string, recipeEnv: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {}

    for (const [key, value] of Object.entries(recipeEnv)) {
      env[key] = value
    }

    for (const [key, value] of Object.entries(globalThis.process.env)) {
      if (typeof value === "string") env[key] = value
    }

    env.FUNNEL_CHANNEL_ID = channelId
    // Pin the MCP child to the same gateway port this launch resolved, so a
    // CLI-default port never diverges from a programmatically-hosted gateway
    // (e.g. nocker's 9742 vs a CLI funnel's 9743). resolveFunnelPort reads
    // FUNNEL_PORT, and process.env already won above, so this just makes the
    // resolved port explicit for the child and its MCP server.
    env.FUNNEL_PORT = String(resolveFunnelPort())

    return env
  }
}
