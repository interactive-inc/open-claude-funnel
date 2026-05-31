import { join } from "node:path"
import { z } from "zod"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"

// The MCP server runs the repo's OWN funnel via `bun funnel mcp` — bun resolves
// node_modules/.bin/funnel from the launch cwd — so a repo launch never depends
// on a globally-installed funnel (which may be absent or a different version).
export const FUNNEL_MCP_COMMAND = "bun"
export const FUNNEL_MCP_ARGS = ["funnel", "mcp"]
export const FUNNEL_MCP_NAME = "funnel"

const mcpEntrySchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
})

const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpEntrySchema).optional(),
})

type McpEntry = z.infer<typeof mcpEntrySchema>
type McpConfig = z.infer<typeof mcpConfigSchema>

type Deps = {
  fs?: FunnelFileSystem
}

const defaultFs = new NodeFunnelFileSystem()

/**
 * Installs/uninstalls the funnel MCP entry into a target repository's
 * `.mcp.json`. Detects an existing entry by command match so renaming is
 * preserved across re-installs.
 */
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
      args: FUNNEL_MCP_ARGS,
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

      if (this.isFunnelEntry(value)) return name
    }

    return null
  }

  // Matches the current `bun funnel mcp` form AND the legacy global `funnel mcp`
  // form, so a re-install migrates an old entry to the repo-local one in place.
  private isFunnelEntry(value: McpEntry | undefined): boolean {
    if (!value) return false
    if (value.command === "bun" && value.args?.[0] === "funnel") return true
    if (value.command === "funnel") return true
    return false
  }

  private readConfig(repoPath: string): McpConfig {
    const mcpPath = join(repoPath, ".mcp.json")

    if (!this.fs.existsSync(mcpPath)) return {}

    const content = this.fs.readFileSync(mcpPath).trim()

    if (!content) return {}

    let parsed: unknown

    try {
      parsed = JSON.parse(content)
    } catch (error) {
      throw new Error(
        `invalid .mcp.json (${mcpPath}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const result = mcpConfigSchema.safeParse(parsed)

    if (!result.success) {
      throw new Error(`invalid .mcp.json (${mcpPath}): ${result.error.message}`)
    }

    return result.data
  }

  private writeConfig(repoPath: string, config: McpConfig): void {
    const mcpPath = join(repoPath, ".mcp.json")

    this.fs.writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`)
  }
}
