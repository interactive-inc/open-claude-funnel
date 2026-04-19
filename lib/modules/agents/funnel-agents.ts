import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import type { AgentConfig } from "@/modules/settings/settings-schema"

type Deps = {
  store: FunnelSettingsReader
}

export class FunnelAgents {
  private readonly store: FunnelSettingsReader

  constructor(deps: Deps) {
    this.store = deps.store
    Object.freeze(this)
  }

  list(): AgentConfig[] {
    return this.store.read().agents
  }

  get(name: string): AgentConfig | null {
    return this.list().find((a) => a.name === name) ?? null
  }

  add(config: AgentConfig): void {
    const settings = this.store.read()

    if (settings.agents.some((a) => a.name === config.name)) {
      throw new Error(`agent "${config.name}" already exists`)
    }

    if (!settings.channels.some((c) => c.name === config.channel)) {
      throw new Error(`channel "${config.channel}" not found`)
    }

    if (config.repo && !settings.repositories.some((r) => r.name === config.repo)) {
      throw new Error(`repo "${config.repo}" not found`)
    }

    settings.agents.push(config)

    this.store.write(settings)
  }

  remove(name: string): void {
    const settings = this.store.read()

    const index = settings.agents.findIndex((a) => a.name === name)

    if (index < 0) throw new Error(`agent "${name}" not found`)

    settings.agents.splice(index, 1)

    this.store.write(settings)
  }

  rename(oldName: string, newName: string): void {
    const settings = this.store.read()

    const agent = settings.agents.find((a) => a.name === oldName)

    if (!agent) throw new Error(`agent "${oldName}" not found`)

    if (settings.agents.some((a) => a.name === newName)) {
      throw new Error(`agent "${newName}" already exists`)
    }

    agent.name = newName

    this.store.write(settings)
  }

  update(name: string, fields: Partial<Omit<AgentConfig, "name">>): void {
    const settings = this.store.read()

    const agent = settings.agents.find((a) => a.name === name)

    if (!agent) throw new Error(`agent "${name}" not found`)

    if (fields.channel !== undefined) {
      if (!settings.channels.some((c) => c.name === fields.channel)) {
        throw new Error(`channel "${fields.channel}" not found`)
      }

      agent.channel = fields.channel
    }

    if (fields.repo !== undefined) {
      if (fields.repo && !settings.repositories.some((r) => r.name === fields.repo)) {
        throw new Error(`repo "${fields.repo}" not found`)
      }

      agent.repo = fields.repo || undefined
    }

    if (fields.subAgent !== undefined) {
      agent.subAgent = fields.subAgent || undefined
    }

    if (fields.envFiles !== undefined) {
      agent.envFiles = fields.envFiles
    }

    this.store.write(settings)
  }
}
