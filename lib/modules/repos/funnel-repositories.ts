import type { FunnelMcp } from "@/modules/mcp/funnel-mcp"
import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import type { RepositoryConfig } from "@/modules/settings/settings-schema"

type Deps = {
  store: FunnelSettingsReader
  mcp: FunnelMcp
}

export class FunnelRepositories {
  private readonly store: FunnelSettingsReader
  private readonly mcp: FunnelMcp

  constructor(deps: Deps) {
    this.store = deps.store
    this.mcp = deps.mcp
    Object.freeze(this)
  }

  list(): RepositoryConfig[] {
    return this.store.read().repositories
  }

  get(name: string): RepositoryConfig | null {
    return this.list().find((r) => r.name === name) ?? null
  }

  add(config: RepositoryConfig): void {
    const settings = this.store.read()

    if (settings.repositories.some((r) => r.name === config.name)) {
      throw new Error(`repo "${config.name}" already exists`)
    }

    this.mcp.install(config.path)

    settings.repositories.push(config)

    this.store.write(settings)
  }

  remove(name: string): void {
    const settings = this.store.read()

    const index = settings.repositories.findIndex((r) => r.name === name)

    if (index < 0) throw new Error(`repo "${name}" not found`)

    if (settings.agents.some((a) => a.repo === name)) {
      throw new Error(`repo "${name}" is referenced by an agent`)
    }

    const repo = settings.repositories[index]!

    this.mcp.uninstall(repo.path)

    settings.repositories.splice(index, 1)

    this.store.write(settings)
  }

  rename(oldName: string, newName: string): void {
    const settings = this.store.read()

    const repo = settings.repositories.find((r) => r.name === oldName)

    if (!repo) throw new Error(`repo "${oldName}" not found`)

    if (settings.repositories.some((r) => r.name === newName)) {
      throw new Error(`repo "${newName}" already exists`)
    }

    repo.name = newName

    for (const agent of settings.agents) {
      if (agent.repo === oldName) agent.repo = newName
    }

    this.store.write(settings)
  }

  update(name: string, fields: Partial<Pick<RepositoryConfig, "path">>): void {
    const settings = this.store.read()

    const repo = settings.repositories.find((r) => r.name === name)

    if (!repo) throw new Error(`repo "${name}" not found`)

    if (fields.path !== undefined && fields.path !== repo.path) {
      this.mcp.uninstall(repo.path)

      this.mcp.install(fields.path)

      repo.path = fields.path
    }

    this.store.write(settings)
  }

  resolvePath(name: string): string {
    const repo = this.get(name)

    if (!repo) throw new Error(`repo "${name}" not found`)

    return repo.path
  }
}
