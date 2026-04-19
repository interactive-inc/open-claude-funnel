import { join } from "node:path"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"

export const FUNNEL_MCP_COMMAND = "funnel"
export const FUNNEL_MCP_NAME = "funnel"

type McpEntry = {
  command?: string
  args?: string[]
}

type McpConfig = {
  mcpServers?: Record<string, McpEntry>
}

type Deps = {
  fs?: FunnelFileSystem
}

const defaultFs = new NodeFunnelFileSystem()

export class FunnelMcp {
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps = {}) {
    this.fs = deps.fs ?? defaultFs
    Object.freeze(this)
  }

  install(repoPath: string): void {
    if (!this.fs.existsSync(repoPath)) {
      throw new Error(`repository does not exist: ${repoPath}`)
    }

    const config = this.readConfig(repoPath)
    const servers = config.mcpServers ?? {}

    const existingName = this.findServerName(servers)
    const targetName = existingName ?? FUNNEL_MCP_NAME

    servers[targetName] = {
      command: FUNNEL_MCP_COMMAND,
      args: ["mcp"],
    }

    this.writeConfig(repoPath, { ...config, mcpServers: servers })
  }

  uninstall(repoPath: string): void {
    if (!this.fs.existsSync(repoPath)) return

    const config = this.readConfig(repoPath)
    const servers = config.mcpServers ?? {}

    const name = this.findServerName(servers)

    if (!name) return

    const next = { ...servers }

    delete next[name]

    this.writeConfig(repoPath, { ...config, mcpServers: next })
  }

  findInstalledName(cwd: string): string | null {
    const config = this.readConfig(cwd)

    return this.findServerName(config.mcpServers ?? {})
  }

  private findServerName(servers: Record<string, McpEntry>): string | null {
    for (const entry of Object.entries(servers)) {
      const name = entry[0]
      const value = entry[1]

      if (value?.command === FUNNEL_MCP_COMMAND) return name
    }

    return null
  }

  private readConfig(repoPath: string): McpConfig {
    const mcpPath = join(repoPath, ".mcp.json")

    if (!this.fs.existsSync(mcpPath)) return {}

    const content = this.fs.readFileSync(mcpPath).trim()

    if (!content) return {}

    try {
      return JSON.parse(content) as McpConfig
    } catch (error) {
      throw new Error(
        `invalid .mcp.json (${mcpPath}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private writeConfig(repoPath: string, config: McpConfig): void {
    const mcpPath = join(repoPath, ".mcp.json")

    this.fs.writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`)
  }
}
