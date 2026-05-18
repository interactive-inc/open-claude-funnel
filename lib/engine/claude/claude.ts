import { join } from "node:path"
import type { FunnelChannels } from "@/engine/channels/channels"
import type { GatewayController } from "@/engine/claude/gateway-controller"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelLogger } from "@/engine/logger/logger"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import type { FunnelMcp } from "@/engine/mcp/mcp"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"

export type LaunchOptions = {
  channel: string
  cwd?: string
  subAgent?: string
  userArgs?: string[]
  profileName?: string
  /** Forward `--brief` to claude on launch (enables the SendUserMessage tool). */
  brief?: boolean
  /** Extra env vars merged under process.env (process.env wins on collision). */
  extraEnv?: Record<string, string>
}

type Deps = {
  channels: FunnelChannels
  mcp: FunnelMcp
  gateway: GatewayController
  process?: FunnelProcessRunner
  fs?: FunnelFileSystem
  logger?: FunnelLogger
  dir?: string
}

const defaultProcess = new NodeFunnelProcessRunner()
const defaultFs = new NodeFunnelFileSystem()
const defaultLogger = new NodeFunnelLogger()

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
  private readonly process: FunnelProcessRunner
  private readonly fs: FunnelFileSystem
  private readonly logger: FunnelLogger
  private readonly pidDir: string

  constructor(deps: Deps) {
    this.channels = deps.channels
    this.mcp = deps.mcp
    this.gateway = deps.gateway
    this.process = deps.process ?? defaultProcess
    this.fs = deps.fs ?? defaultFs
    this.logger = deps.logger ?? defaultLogger
    this.pidDir = join(deps.dir ?? FUNNEL_DIR, "claude")
    Object.freeze(this)
  }

  async launch(options: LaunchOptions): Promise<number> {
    const channel = this.channels.get(options.channel) ?? this.channels.getById(options.channel)

    if (!channel) {
      throw new Error(`channel "${options.channel}" not found`)
    }

    if (options.profileName && this.isRunning(options.profileName)) {
      throw new Error(`profile "${options.profileName}" is already running`)
    }

    const cwd = options.cwd ?? globalThis.process.cwd()

    if (!this.mcp.findInstalledName(cwd)) {
      this.mcp.install(cwd)

      this.logger.info(`added funnel MCP to .mcp.json`, { cwd })
    }

    if (!this.gateway.isRunning()) {
      this.logger.info(`starting gateway automatically`)
      await this.gateway.start()
    }

    if (options.profileName) {
      this.writePidFile(options.profileName)
      this.installCleanup(options.profileName)
    }

    const claudeArgs = this.buildArgs(options, cwd)
    const env = this.buildEnv(channel.id, options.extraEnv)

    this.logger.info(`claude launch`, {
      channel: options.channel,
      channelId: channel.id,
      subAgent: options.subAgent,
      cwd,
    })

    try {
      return await this.process.attach(["claude", ...claudeArgs], { cwd, env })
    } finally {
      if (options.profileName) this.removePidFile(options.profileName)
    }
  }

  isRunning(profileName: string): boolean {
    const pid = this.readPid(profileName)

    if (!pid) return false

    return this.isProcessAlive(pid)
  }

  private pidPath(profileName: string): string {
    return join(this.pidDir, `${profileName}.pid`)
  }

  private readPid(profileName: string): number | null {
    const path = this.pidPath(profileName)

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

  private writePidFile(profileName: string): void {
    this.fs.mkdirSync(this.pidDir, { recursive: true })
    this.fs.writeFileSync(this.pidPath(profileName), String(globalThis.process.pid))
  }

  private removePidFile(profileName: string): void {
    const path = this.pidPath(profileName)

    if (this.fs.existsSync(path)) this.fs.unlink(path)
  }

  private installCleanup(profileName: string): void {
    // Default Bun behavior on SIGINT/SIGTERM is process.exit(130/143), which
    // fires the "exit" event. Hooking only "exit" keeps the PID file cleanup
    // running while letting the signal terminate the process normally —
    // adding our own SIGINT handler would suppress the default exit and leave
    // funnel hanging until claude responds.
    globalThis.process.once("exit", () => this.removePidFile(profileName))
  }

  private isProcessAlive(pid: number): boolean {
    const result = this.process.runSync(["ps", "-p", String(pid), "-o", "state="])

    if (result.exitCode !== 0) return false

    const state = result.stdout.trim()

    if (!state) return false

    return !state.startsWith("Z")
  }

  private buildArgs(options: LaunchOptions, cwd: string): string[] {
    const result = [...(options.userArgs ?? [])]

    const mcpName = this.mcp.findInstalledName(cwd)

    if (
      mcpName &&
      !result.includes("--dangerously-load-development-channels") &&
      !result.includes("--channels")
    ) {
      result.push("--dangerously-load-development-channels", `server:${mcpName}`)
    }

    if (!result.includes("--agent") && options.subAgent) {
      result.push("--agent", options.subAgent)
    }

    if (options.brief && !result.includes("--brief")) {
      result.push("--brief")
    }

    return result
  }

  private buildEnv(channelId: string, extraEnv: Record<string, string> | undefined): Record<string, string> {
    const env: Record<string, string> = {}

    if (extraEnv) {
      for (const [key, value] of Object.entries(extraEnv)) {
        env[key] = value
      }
    }

    for (const [key, value] of Object.entries(globalThis.process.env)) {
      if (typeof value === "string") env[key] = value
    }

    env.FUNNEL_CHANNEL_ID = channelId

    return env
  }
}
