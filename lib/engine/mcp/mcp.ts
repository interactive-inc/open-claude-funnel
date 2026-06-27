import { join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"

// The MCP server runs the repo's OWN funnel via `bun funnel mcp` — bun resolves
// node_modules/.bin/funnel from the launch cwd — so a repo launch never depends
// on a globally-installed funnel (which may be absent or a different version).
export const FUNNEL_MCP_COMMAND = "bun"
export const FUNNEL_MCP_ARGS = ["funnel", "mcp"]
export const FUNNEL_MCP_NAME = "funnel"

type Deps = {
  fs?: FunnelFileSystem
}

const defaultFs = new NodeFunnelFileSystem()

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Installs/uninstalls the funnel MCP entry into a target repository's
 * `.mcp.json`. Detects an existing entry by command match so renaming is
 * preserved across re-installs.
 *
 * The raw JSON object is mutated and written back untouched apart from the
 * funnel entry — third-party server fields (`type`, `url`, `env`, `headers`, …)
 * and unrelated top-level keys are preserved verbatim. Never round-trip the
 * file through a narrowing schema: that silently strips every key it does not
 * declare, corrupting other MCP servers.
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

    // Two concurrent 'fnl claude' on the same repo (or a parallel claude-code
    // edit) would otherwise both read the same .mcp.json, each merge its own
    // entry, and the slower write would drop the other's edit. The lockfile
    // serializes the read+merge+write into one atomic step.
    this.fs.withFileLock(join(repoPath, ".mcp.json.lock"), () => {
      const config = this.readConfig(repoPath)
      const existing = config.mcpServers
      const servers = isRecord(existing) ? existing : {}

      const existingName = this.findServerName(servers)
      const targetName = existingName ?? FUNNEL_MCP_NAME

      servers[targetName] = {
        command: FUNNEL_MCP_COMMAND,
        args: FUNNEL_MCP_ARGS,
      }
      config.mcpServers = servers

      this.writeConfig(repoPath, config)
    })
  }

  uninstall(repoPath: string): void {
    if (!this.fs.existsSync(repoPath)) return

    this.fs.withFileLock(join(repoPath, ".mcp.json.lock"), () => {
      const config = this.readConfig(repoPath)
      const servers = config.mcpServers

      if (!isRecord(servers)) return

      const name = this.findServerName(servers)

      if (!name) return

      delete servers[name]

      this.writeConfig(repoPath, config)
    })
  }

  findInstalledName(cwd: string): string | null {
    const config = this.readConfig(cwd)
    const servers = config.mcpServers

    return isRecord(servers) ? this.findServerName(servers) : null
  }

  private findServerName(servers: Record<string, unknown>): string | null {
    for (const entry of Object.entries(servers)) {
      if (this.isFunnelEntry(entry[1])) return entry[0]
    }

    return null
  }

  // Matches the current `bun funnel mcp` form AND the legacy global `funnel mcp`
  // form, so a re-install migrates an old entry to the repo-local one in place.
  private isFunnelEntry(value: unknown): boolean {
    if (!isRecord(value)) return false

    const command = value.command
    const args = value.args

    if (command === "bun" && Array.isArray(args) && args[0] === "funnel") return true
    if (command === "funnel") return true

    return false
  }

  private readConfig(repoPath: string): Record<string, unknown> {
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

    if (!isRecord(parsed)) {
      throw new Error(`invalid .mcp.json (${mcpPath}): expected a JSON object`)
    }

    return parsed
  }

  private writeConfig(repoPath: string, config: Record<string, unknown>): void {
    const mcpPath = join(repoPath, ".mcp.json")

    this.fs.writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`)
  }
}
