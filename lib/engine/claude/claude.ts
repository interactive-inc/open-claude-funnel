import type { ChannelResolver } from "@/engine/claude/channel-resolver"
import type { GatewayController } from "@/engine/claude/gateway-controller"
import type { McpInstaller } from "@/engine/claude/mcp-installer"
import type { ProcessGuard } from "@/engine/claude/process-guard"
import type { SessionStore } from "@/engine/claude/session-store"
import { FunnelIdGenerator } from "@/engine/id/id-generator"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { FunnelLogger } from "@/engine/logger/logger"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { resolveFunnelPort } from "@/engine/settings/settings-store"

type LaunchCommon = {
  channel: string
  cwd?: string
  userArgs?: string[]
  /** Args prepended to the claude argv (typically a profile's recipe). Defaults to none. */
  options?: string[]
  /** Env vars layered under the launched claude process. process.env wins on collision. */
  env?: Record<string, string>
  /** Invoked synchronously after the child claude process has been spawned, with its PID.
   *  Useful for hosts that need to register the spawned process before it exits
   *  (e.g. multi-session registries that track per-claude liveness). */
  onSpawned?: (pid: number) => void
  /** Whether to install the funnel MCP entry into `.mcp.json` (default: true).
   *  Set to false when the host already provides its own MCP server entry and
   *  does not need the funnel binary as an MCP endpoint. */
  installMcp?: boolean
}

/**
 * A launch carries one of two targets, distinguished by `profileId`.
 *
 * - **profile launch** — has a stable `profileId` (uuid). Enforces singleton-ness
 *   via the PID file and may opt into `resume` to reuse the profile's session.
 * - **profile-less launch** — raw `--channel`. Never enforces singleton-ness and
 *   always starts a fresh session, so `resume` is meaningless and disallowed.
 *
 * Modeling these as a union (rather than two independent optional fields) makes
 * `resume` without a `profileId` a compile error — previously it was silently
 * ignored, which masked real bugs (a profile resume that never took effect).
 */
type LaunchTarget =
  | {
      /** Stable id of the launching profile (uuid). Keys the singleton PID file
       *  and the resumable session. */
      profileId: string
      /** Inject `--session-id`/`--resume` for this profile (opt-in, default false).
       *  The persisted session is owned by the profile (by id). */
      resume?: boolean
    }
  | { profileId?: undefined; resume?: undefined }

export type LaunchOptions = LaunchCommon & LaunchTarget

type SessionResolution = { id: string; mode: "resume" | "new" } | null

type Deps = {
  channels: ChannelResolver
  mcp: McpInstaller
  gateway: GatewayController
  sessions: SessionStore
  guard: ProcessGuard
  process?: FunnelProcessRunner
  idGenerator?: FunnelIdGenerator
  logger?: FunnelLogger
}

const defaultProcess = new NodeFunnelProcessRunner()
const defaultIdGenerator = new NodeFunnelIdGenerator()

/**
 * Launches Claude Code with funnel pre-wired: ensures the gateway is running,
 * installs the funnel MCP into the target repo's `.mcp.json` if missing,
 * injects `FUNNEL_CHANNEL_ID` into the child env, and delegates singleton
 * enforcement to a ProcessGuard.
 */
export class FunnelClaude {
  private readonly channels: ChannelResolver
  private readonly mcp: McpInstaller
  private readonly gateway: GatewayController
  private readonly sessions: SessionStore
  private readonly guard: ProcessGuard
  private readonly process: FunnelProcessRunner
  private readonly idGenerator: FunnelIdGenerator
  private readonly logger: FunnelLogger | undefined

  constructor(deps: Deps) {
    this.channels = deps.channels
    this.mcp = deps.mcp
    this.gateway = deps.gateway
    this.sessions = deps.sessions
    this.guard = deps.guard
    this.process = deps.process ?? defaultProcess
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator
    this.logger = deps.logger
    Object.freeze(this)
  }

  async launch(options: LaunchOptions): Promise<number> {
    const channel = this.channels.get(options.channel) ?? this.channels.getById(options.channel)

    if (!channel) {
      throw new Error(`channel "${options.channel}" not found`)
    }

    if (options.profileId && this.guard.isRunning(options.profileId)) {
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
      this.guard.acquire(options.profileId)
    }

    const resume = options.resume ?? false
    const session =
      resume && options.profileId
        ? this.resolveSession(options.profileId, cwd, options.userArgs ?? [], options.env ?? {})
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
      if (options.profileId) this.guard.release(options.profileId)
    }
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

    const existing = this.sessions.getSessionId(profileId)

    if (existing !== null && this.sessions.sessionFileExists(cwd, existing, recipeEnv)) {
      return { id: existing, mode: "resume" }
    }

    const fresh = this.idGenerator.generate()

    this.sessions.setSessionId(profileId, fresh)

    return { id: fresh, mode: "new" }
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
