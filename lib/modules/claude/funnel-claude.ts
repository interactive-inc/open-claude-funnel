import type { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"
import type { FunnelGateway } from "@/modules/gateway/funnel-gateway"
import { logger } from "@/modules/logger"
import type { FunnelMcp } from "@/modules/mcp/funnel-mcp"
import { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import { NodeFunnelProcessRunner } from "@/modules/process/node-funnel-process-runner"
import type { FunnelRepositories } from "@/modules/repos/funnel-repositories"

export type LaunchOptions = {
  channel: string
  repo?: string
  subAgent?: string
  envFiles?: string[]
  userArgs?: string[]
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

    const cwd = options.repo ? this.repositories.resolvePath(options.repo) : globalThis.process.cwd()

    if (!this.mcp.findInstalledName(cwd)) {
      this.mcp.install(cwd)

      logger.info(`added funnel MCP to .mcp.json`, { cwd })
    }

    if (!this.gateway.isRunning()) {
      logger.info(`starting gateway automatically`)
      await this.gateway.start()
    }

    const claudeArgs = this.buildArgs(options, cwd)
    const env = this.buildEnv(options, cwd)

    logger.info(`claude launch`, {
      channel: options.channel,
      repo: options.repo,
      subAgent: options.subAgent,
      cwd,
    })

    return await this.process.attach(["claude", ...claudeArgs], { cwd, env })
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
