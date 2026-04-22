import type { ChannelConnectorRefUpdater } from "@/modules/channels/channel-connector-ref-updater"
import type { ConnectorConfig } from "@/modules/connectors/connector-config-schema"
import type { CallInput } from "@/modules/connectors/funnel-connector-adapter"
import type { FunnelConnectorListener } from "@/modules/connectors/funnel-connector-listener"
import type { FunnelDiscordStore } from "@/modules/connectors/funnel-discord-store"
import type { FunnelGhStore } from "@/modules/connectors/funnel-gh-store"
import type { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import type { FunnelSlackStore } from "@/modules/connectors/funnel-slack-store"

type Deps = {
  slack: FunnelSlackStore
  gh: FunnelGhStore
  discord: FunnelDiscordStore
  schedule: FunnelScheduleStore
  refUpdater: ChannelConnectorRefUpdater
}

export type ConnectorUpdateFields = {
  botToken?: string
  appToken?: string
  pollInterval?: number
}

export class FunnelConnectors {
  private readonly slack: FunnelSlackStore
  private readonly gh: FunnelGhStore
  private readonly discord: FunnelDiscordStore
  private readonly schedule: FunnelScheduleStore
  private readonly refUpdater: ChannelConnectorRefUpdater

  constructor(deps: Deps) {
    this.slack = deps.slack
    this.gh = deps.gh
    this.discord = deps.discord
    this.schedule = deps.schedule
    this.refUpdater = deps.refUpdater
    Object.freeze(this)
  }

  list(): ConnectorConfig[] {
    return [
      ...this.slack.list(),
      ...this.gh.list(),
      ...this.discord.list(),
      ...this.schedule.list(),
    ]
  }

  get(name: string): ConnectorConfig | null {
    return (
      this.slack.get(name) ??
      this.gh.get(name) ??
      this.discord.get(name) ??
      this.schedule.get(name)
    )
  }

  has(name: string): boolean {
    return (
      this.slack.has(name) ||
      this.gh.has(name) ||
      this.discord.has(name) ||
      this.schedule.has(name)
    )
  }

  add(config: ConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`)

    if (config.type === "slack") return this.slack.add(config)
    if (config.type === "gh") return this.gh.add(config)
    if (config.type === "discord") return this.discord.add(config)

    return this.schedule.add(config)
  }

  update(name: string, fields: ConnectorUpdateFields): void {
    const current = this.get(name)

    if (!current) throw new Error(`connector "${name}" not found`)

    if (current.type === "slack") {
      return this.slack.update(name, { botToken: fields.botToken, appToken: fields.appToken })
    }

    if (current.type === "gh") {
      return this.gh.update(name, { pollInterval: fields.pollInterval })
    }

    if (current.type === "discord") {
      return this.discord.update(name, { botToken: fields.botToken })
    }

    throw new Error(`schedule connectors have no top-level fields — use schedule entry operations`)
  }

  remove(name: string): void {
    const current = this.get(name)

    if (!current) throw new Error(`connector "${name}" not found`)

    if (current.type === "slack") this.slack.remove(name)
    else if (current.type === "gh") this.gh.remove(name)
    else if (current.type === "discord") this.discord.remove(name)
    else this.schedule.remove(name)

    this.refUpdater.removeRef(name)
  }

  rename(oldName: string, newName: string): void {
    const current = this.get(oldName)

    if (!current) throw new Error(`connector "${oldName}" not found`)
    if (this.has(newName)) throw new Error(`connector "${newName}" already exists`)

    if (current.type === "slack") this.slack.rename(oldName, newName)
    else if (current.type === "gh") this.gh.rename(oldName, newName)
    else if (current.type === "discord") this.discord.rename(oldName, newName)
    else this.schedule.rename(oldName, newName)

    this.refUpdater.renameRef(oldName, newName)
  }

  async call(name: string, input: CallInput): Promise<unknown> {
    const config = this.get(name)

    if (!config) throw new Error(`connector "${name}" not found`)

    if (config.type === "slack") return await this.slack.createAdapter(config).call(input)
    if (config.type === "gh") return await this.gh.createAdapter(config).call(input)
    if (config.type === "discord") return await this.discord.createAdapter(config).call(input)

    throw new Error(`connector "${name}" (${config.type}) does not support call()`)
  }

  createListeners(): { config: ConnectorConfig; listener: FunnelConnectorListener }[] {
    return [
      ...this.slack.createAllListeners(),
      ...this.gh.createAllListeners(),
      ...this.discord.createAllListeners(),
      ...this.schedule.createAllListeners(),
    ]
  }
}
