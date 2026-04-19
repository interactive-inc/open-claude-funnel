import type { CallInput } from "@/modules/connectors/funnel-connector-adapter"
import { FunnelDiscordAdapter } from "@/modules/connectors/funnel-discord-adapter"
import { FunnelGhAdapter } from "@/modules/connectors/funnel-gh-adapter"
import { FunnelSlackAdapter } from "@/modules/connectors/funnel-slack-adapter"
import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import type { ConnectorConfig } from "@/modules/settings/settings-schema"

type Deps = {
  store: FunnelSettingsReader
}

type UpdateFields = {
  botToken?: string
  appToken?: string
  pollInterval?: number
}

export class FunnelConnectors {
  private readonly store: FunnelSettingsReader

  constructor(deps: Deps) {
    this.store = deps.store
    Object.freeze(this)
  }

  list(): ConnectorConfig[] {
    return this.store.read().connectors
  }

  get(name: string): ConnectorConfig | null {
    return this.list().find((c) => c.name === name) ?? null
  }

  add(config: ConnectorConfig): void {
    const settings = this.store.read()

    if (settings.connectors.some((c) => c.name === config.name)) {
      throw new Error(`connector "${config.name}" already exists`)
    }

    settings.connectors.push(config)

    this.store.write(settings)
  }

  rename(oldName: string, newName: string): void {
    const settings = this.store.read()

    const connector = settings.connectors.find((c) => c.name === oldName)

    if (!connector) throw new Error(`connector "${oldName}" not found`)

    if (settings.connectors.some((c) => c.name === newName)) {
      throw new Error(`connector "${newName}" already exists`)
    }

    connector.name = newName

    for (const channel of settings.channels) {
      const index = channel.connectors.indexOf(oldName)

      if (index >= 0) channel.connectors[index] = newName
    }

    this.store.write(settings)
  }

  update(name: string, fields: UpdateFields): void {
    const settings = this.store.read()

    const connector = settings.connectors.find((c) => c.name === name)

    if (!connector) throw new Error(`connector "${name}" not found`)

    if (connector.type === "slack") {
      if (fields.botToken !== undefined) connector.botToken = fields.botToken
      if (fields.appToken !== undefined) connector.appToken = fields.appToken
    } else if (connector.type === "gh") {
      if (fields.pollInterval !== undefined) connector.pollInterval = fields.pollInterval
    } else if (connector.type === "discord") {
      if (fields.botToken !== undefined) connector.botToken = fields.botToken
    }

    this.store.write(settings)
  }

  remove(name: string): void {
    const settings = this.store.read()

    const index = settings.connectors.findIndex((c) => c.name === name)

    if (index < 0) throw new Error(`connector "${name}" not found`)

    settings.connectors.splice(index, 1)

    for (const channel of settings.channels) {
      const ci = channel.connectors.indexOf(name)

      if (ci >= 0) channel.connectors.splice(ci, 1)
    }

    this.store.write(settings)
  }

  async call(name: string, input: CallInput): Promise<unknown> {
    const connector = this.get(name)

    if (!connector) throw new Error(`connector "${name}" not found`)

    if (connector.type === "slack") {
      return await new FunnelSlackAdapter({ config: connector }).call(input)
    }

    if (connector.type === "gh") {
      return await new FunnelGhAdapter().call(input)
    }

    if (connector.type === "discord") {
      return await new FunnelDiscordAdapter({ config: connector }).call(input)
    }

    throw new Error(`unsupported connector type: ${(connector as { type: string }).type}`)
  }
}
