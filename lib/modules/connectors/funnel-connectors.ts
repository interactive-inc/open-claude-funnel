import type { ChannelConnectorRefUpdater } from "@/modules/channels/channel-connector-ref-updater"
import type { ConnectorConfig } from "@/modules/connectors/connector-config-schema"
import type { CallInput } from "@/modules/connectors/funnel-connector-adapter"
import type { FunnelConnectorListener } from "@/modules/connectors/funnel-connector-listener"
import type {
  DiscordUpdateFields,
  FunnelDiscordStore,
} from "@/modules/connectors/funnel-discord-store"
import type { FunnelGhStore, GhUpdateFields } from "@/modules/connectors/funnel-gh-store"
import type { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import type { FunnelSlackStore, SlackUpdateFields } from "@/modules/connectors/funnel-slack-store"

type Deps = {
  slack: FunnelSlackStore
  gh: FunnelGhStore
  discord: FunnelDiscordStore
  schedule: FunnelScheduleStore
  refUpdater: ChannelConnectorRefUpdater
}

/**
 * Aggregates per-type connector stores (slack / gh / discord / schedule) behind a single facade.
 * Add / remove / rename mutate the underlying type-specific store and propagate name changes
 * to channel references via `refUpdater`. Per-type APIs (`updateSlack`, `callDiscord`, ...) keep
 * field-level operations type-narrowed without runtime defense.
 */
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

  updateSlack(name: string, fields: SlackUpdateFields): void {
    this.slack.update(name, fields)
  }

  updateGh(name: string, fields: GhUpdateFields): void {
    this.gh.update(name, fields)
  }

  updateDiscord(name: string, fields: DiscordUpdateFields): void {
    this.discord.update(name, fields)
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

  async callSlack(name: string, input: CallInput): Promise<unknown> {
    const config = this.slack.get(name)

    if (!config) throw new Error(`slack connector "${name}" not found`)

    return await this.slack.createAdapter(config).call(input)
  }

  async callGh(name: string, input: CallInput): Promise<unknown> {
    const config = this.gh.get(name)

    if (!config) throw new Error(`gh connector "${name}" not found`)

    return await this.gh.createAdapter(config).call(input)
  }

  async callDiscord(name: string, input: CallInput): Promise<unknown> {
    const config = this.discord.get(name)

    if (!config) throw new Error(`discord connector "${name}" not found`)

    return await this.discord.createAdapter(config).call(input)
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
