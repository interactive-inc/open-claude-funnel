import { join } from "node:path"
import type { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"
import type { FunnelGateway } from "@/modules/gateway/funnel-gateway"
import { logger } from "@/modules/logger"
import type { FunnelMcp } from "@/modules/mcp/funnel-mcp"
import { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import { NodeFunnelProcessRunner } from "@/modules/process/node-funnel-process-runner"
import type { FunnelRepositories } from "@/modules/repos/funnel-repositories"
import { FUNNEL_DIR } from "@/modules/settings/funnel-settings-store"

const CLAUDE_PID_DIR = join(FUNNEL_DIR, "claude")

export type LaunchOptions = {
  channel: string
  repo?: string
  subAgent?: string
  envFiles?: string[]
  userArgs?: string[]
  profileName?: string
}

type Deps = {
  channels: FunnelChannels
  repositories: FunnelRepositories
  mcp: FunnelMcp
  gateway: FunnelGateway
  process?: FunnelProcessRunner
  fs?: FunnelFileSystem
}

const defaultProcess = new NodeFunnelProcessRunner()
const defaultFs = new NodeFunnelFileSystem()

export class FunnelClaude {
  private readonly channels: FunnelChannels
  private readonly repositories: FunnelRepositories
  private readonly mcp: FunnelMcp
  private readonly gateway: FunnelGateway
  private readonly process: FunnelProcessRunner
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps) {
    this.channels = deps.channels
    this.repositories = deps.repositories
    this.mcp = deps.mcp
    this.gateway = deps.gateway
    this.process = deps.process ?? defaultProcess
    this.fs = deps.fs ?? defaultFs
    Object.freeze(this)
  }

  async launch(options: LaunchOptions): Promise<number> {
    const channel = this.channels.get(options.channel)

    if (!channel) {
      throw new Error(`channel "${options.channel}" not found`)
    }

    if (options.profileName && this.isRunning(options.profileName)) {
      throw new Error(`profile "${options.profileName}" is already running`)
    }

    const cwd = options.repo
      ? this.repositories.resolvePath(options.repo)
      : globalThis.process.cwd()

    if (!this.mcp.findInstalledName(cwd)) {
      this.mcp.install(cwd)

      logger.info(`added funnel MCP to .mcp.json`, { cwd })
    }

    if (!this.gateway.isRunning()) {
      logger.info(`starting gateway automatically`)
      await this.gateway.start()
    }

    if (options.profileName) {
      this.writePidFile(options.profileName)
      this.installCleanup(options.profileName)
    }

    const claudeArgs = this.buildArgs(options, cwd)
    const env = this.buildEnv(options, cwd)

    logger.info(`claude launch`, {
      channel: options.channel,
      repo: options.repo,
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
    return join(CLAUDE_PID_DIR, `${profileName}.pid`)
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
    this.fs.mkdirSync(CLAUDE_PID_DIR, { recursive: true })
    this.fs.writeFileSync(this.pidPath(profileName), String(globalThis.process.pid))
  }

  private removePidFile(profileName: string): void {
    const path = this.pidPath(profileName)

    if (this.fs.existsSync(path)) this.fs.unlink(path)
  }

  private installCleanup(profileName: string): void {
    const cleanup = () => this.removePidFile(profileName)

    globalThis.process.once("exit", cleanup)
    globalThis.process.once("SIGINT", cleanup)
    globalThis.process.once("SIGTERM", cleanup)
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

    return result
  }

  private buildEnv(options: LaunchOptions, cwd: string): Record<string, string> {
    const env: Record<string, string> = { ...globalThis.process.env } as Record<string, string>

    if (options.envFiles) {
      for (const file of options.envFiles) {
        const filePath = `${cwd}/${file}`

        if (!this.fs.existsSync(filePath)) continue

        const content = this.fs.readFileSync(filePath)

        for (const line of content.split("\n")) {
          const trimmed = line.trim()

          if (!trimmed || trimmed.startsWith("#")) continue

          const eqIndex = trimmed.indexOf("=")

          if (eqIndex < 0) continue

          const key = trimmed.slice(0, eqIndex)
          const value = trimmed.slice(eqIndex + 1).replace(/^["']|["']$/g, "")

          env[key] = value
        }
      }
    }

    env.FUNNEL_CHANNEL_ID = options.channel

    return env
  }
}
