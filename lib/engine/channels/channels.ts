import type { CallInput } from "@/connectors/connector-adapter"
import type { ConnectorConfig } from "@/connectors/connector-config-schema"
import type { FunnelConnectorFactory } from "@/connectors/connector-factory"
import type { FunnelConnectorListener } from "@/connectors/connector-listener"
import type { DiscordConnectorConfig } from "@/connectors/discord-connector-schema"
import type { ScheduleEntry } from "@/connectors/schedule-connector-schema"
import { connectorTokens } from "@/engine/channels/connector-tokens"
import { requireConnectorOfType } from "@/engine/channels/require-connector"
import type { ProfileChannelChecker } from "@/engine/profiles/profile-channel-checker"
import { FunnelClock } from "@/engine/time/clock"
import { NodeFunnelClock } from "@/engine/time/node-clock"
import { FunnelIdGenerator } from "@/engine/id/id-generator"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import type {
  ChannelConfig,
  ChannelDeliveryMode,
  Settings,
} from "@/engine/settings/settings-schema"

type Deps = {
  store: FunnelSettingsReader
  factory: FunnelConnectorFactory
  profileChecker: ProfileChannelChecker
  clock?: FunnelClock
  idGenerator?: FunnelIdGenerator
}

export type ChannelConnectorView = ConnectorConfig & {
  channelId: string
  channelName: string
}

type AddConnectorInput =
  | { type: "slack"; name: string; botToken: string; appToken: string }
  | { type: "gh"; name: string; pollInterval?: number }
  | { type: "discord"; name: string; botToken: string }
  | { type: "schedule"; name: string; entries?: ScheduleEntry[] }

const defaultClock = new NodeFunnelClock()
const defaultIdGenerator = new NodeFunnelIdGenerator()

/**
 * Channels own their connectors. Each channel has a stable id (UUID); the
 * `name` is the human-facing label used by the CLI. Connectors live nested
 * inside `channel.connectors[]`, so add/remove/rename are channel-scoped — no
 * global connector namespace exists. Token uniqueness is enforced across all
 * channels at add/update time so the same Slack/Discord credentials cannot
 * be registered twice.
 */
export class FunnelChannels {
  private readonly store: FunnelSettingsReader
  private readonly factory: FunnelConnectorFactory
  private readonly profileChecker: ProfileChannelChecker
  private readonly clock: FunnelClock
  private readonly idGenerator: FunnelIdGenerator

  constructor(deps: Deps) {
    this.store = deps.store
    this.factory = deps.factory
    this.profileChecker = deps.profileChecker
    this.clock = deps.clock ?? defaultClock
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator
    Object.freeze(this)
  }

  list(): ChannelConfig[] {
    return this.store.read().channels
  }

  get(name: string): ChannelConfig | null {
    return this.list().find((c) => c.name === name) ?? null
  }

  getById(id: string): ChannelConfig | null {
    return this.list().find((c) => c.id === id) ?? null
  }

  add(input: {
    name: string
    delivery?: ChannelDeliveryMode
    options?: string[]
    env?: Record<string, string>
    resume?: boolean
  }): ChannelConfig {
    const settings = this.store.read()

    if (settings.channels.some((c) => c.name === input.name)) {
      throw new Error(`channel "${input.name}" already exists`)
    }

    const channel: ChannelConfig = {
      id: this.idGenerator.generate(),
      name: input.name,
      delivery: input.delivery ?? "fanout",
      options: input.options ?? [],
      env: input.env ?? {},
      resume: input.resume ?? true,
      connectors: [],
    }

    settings.channels.push(channel)
    this.store.write(settings)

    return channel
  }

  setDelivery(name: string, delivery: ChannelDeliveryMode): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, name)

    channel.delivery = delivery

    this.store.write(settings)
  }

  setResume(name: string, resume: boolean): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, name)

    channel.resume = resume

    this.store.write(settings)
  }

  setOptions(name: string, options: string[]): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, name)

    channel.options = options

    this.store.write(settings)
  }

  setEnv(name: string, env: Record<string, string>): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, name)

    channel.env = env

    this.store.write(settings)
  }

  remove(name: string): void {
    const settings = this.store.read()
    const index = settings.channels.findIndex((c) => c.name === name)

    if (index < 0) throw new Error(`channel "${name}" not found`)

    const channel = settings.channels[index]

    if (channel && this.profileChecker.hasChannelRef(channel.id)) {
      throw new Error(`channel "${name}" is referenced by a profile`)
    }

    settings.channels.splice(index, 1)
    this.store.write(settings)
  }

  rename(oldName: string, newName: string): void {
    const settings = this.store.read()
    const channel = settings.channels.find((c) => c.name === oldName)

    if (!channel) throw new Error(`channel "${oldName}" not found`)
    if (settings.channels.some((c) => c.name === newName)) {
      throw new Error(`channel "${newName}" already exists`)
    }

    channel.name = newName
    this.store.write(settings)
  }

  listConnectors(channelName: string): ConnectorConfig[] {
    return this.requireChannel(this.store.read(), channelName).connectors
  }

  getConnector(channelName: string, connectorName: string): ConnectorConfig | null {
    const channel = this.get(channelName)

    if (!channel) return null

    return channel.connectors.find((c) => c.name === connectorName) ?? null
  }

  listAllConnectors(): ChannelConnectorView[] {
    const out: ChannelConnectorView[] = []

    for (const channel of this.list()) {
      for (const connector of channel.connectors) {
        out.push({ ...connector, channelId: channel.id, channelName: channel.name })
      }
    }

    return out
  }

  addConnector(channelName: string, input: AddConnectorInput): ConnectorConfig {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, channelName)

    if (channel.connectors.some((c) => c.name === input.name)) {
      throw new Error(`connector "${input.name}" already exists in channel "${channelName}"`)
    }

    const candidate = this.fromInput(input)

    this.assertNoTokenCollision(settings, candidate)

    channel.connectors.push(candidate)
    this.store.write(settings)

    return candidate
  }

  private fromInput(input: AddConnectorInput): ConnectorConfig {
    const id = this.idGenerator.generate()
    const now = this.clock.iso()
    const createdAt = now
    const updatedAt = now

    switch (input.type) {
      case "slack":
        return {
          id,
          type: "slack",
          name: input.name,
          botToken: input.botToken,
          appToken: input.appToken,
          createdAt,
          updatedAt,
        }
      case "gh":
        return {
          id,
          type: "gh",
          name: input.name,
          ...(input.pollInterval !== undefined ? { pollInterval: input.pollInterval } : {}),
          createdAt,
          updatedAt,
        }
      case "discord":
        return {
          id,
          type: "discord",
          name: input.name,
          botToken: input.botToken,
          createdAt,
          updatedAt,
        }
      case "schedule":
        return {
          id,
          type: "schedule",
          name: input.name,
          entries: input.entries ?? [],
          createdAt,
          updatedAt,
        }
    }
  }

  removeConnector(channelName: string, connectorName: string): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, channelName)
    const index = channel.connectors.findIndex((c) => c.name === connectorName)

    if (index < 0) {
      throw new Error(`connector "${connectorName}" not found in channel "${channelName}"`)
    }

    channel.connectors.splice(index, 1)
    this.store.write(settings)
  }

  renameConnector(channelName: string, oldName: string, newName: string): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, channelName)
    const connector = channel.connectors.find((c) => c.name === oldName)

    if (!connector) {
      throw new Error(`connector "${oldName}" not found in channel "${channelName}"`)
    }

    if (channel.connectors.some((c) => c.name === newName)) {
      throw new Error(`connector "${newName}" already exists in channel "${channelName}"`)
    }

    connector.name = newName
    connector.updatedAt = this.clock.iso()
    this.store.write(settings)
  }

  updateSlackConnector(
    channelName: string,
    connectorName: string,
    fields: { botToken?: string; appToken?: string },
  ): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, channelName)
    const connector = requireConnectorOfType(channel, connectorName, "slack")

    const updated = {
      ...connector,
      botToken: fields.botToken ?? connector.botToken,
      appToken: fields.appToken ?? connector.appToken,
      updatedAt: this.clock.iso(),
    }

    this.assertNoTokenCollision(settings, updated)

    Object.assign(connector, updated)
    this.store.write(settings)
  }

  updateGhConnector(
    channelName: string,
    connectorName: string,
    fields: { pollInterval?: number },
  ): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, channelName)
    const connector = requireConnectorOfType(channel, connectorName, "gh")

    if (fields.pollInterval !== undefined) connector.pollInterval = fields.pollInterval
    connector.updatedAt = this.clock.iso()

    this.store.write(settings)
  }

  updateDiscordConnector(
    channelName: string,
    connectorName: string,
    fields: { botToken?: string },
  ): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, channelName)
    const connector = requireConnectorOfType(channel, connectorName, "discord")

    const updated = {
      ...connector,
      botToken: fields.botToken ?? connector.botToken,
      updatedAt: this.clock.iso(),
    }

    this.assertNoTokenCollision(settings, updated)

    Object.assign(connector, updated)
    this.store.write(settings)
  }

  listScheduleEntries(channelName: string, connectorName: string): ScheduleEntry[] {
    const channel = this.requireChannel(this.store.read(), channelName)
    const connector = requireConnectorOfType(channel, connectorName, "schedule")

    return connector.entries
  }

  addScheduleEntry(
    channelName: string,
    connectorName: string,
    entry: Pick<ScheduleEntry, "cron" | "prompt"> &
      Partial<Pick<ScheduleEntry, "id" | "enabled" | "catchupPolicy">>,
  ): ScheduleEntry {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, channelName)
    const connector = requireConnectorOfType(channel, connectorName, "schedule")

    const persisted: ScheduleEntry = {
      id: entry.id ?? this.idGenerator.generate(),
      cron: entry.cron,
      prompt: entry.prompt,
      enabled: entry.enabled ?? true,
      catchupPolicy: entry.catchupPolicy ?? "latest",
    }

    connector.entries.push(persisted)
    connector.updatedAt = this.clock.iso()
    this.store.write(settings)

    return persisted
  }

  removeScheduleEntry(channelName: string, connectorName: string, id: string): void {
    const settings = this.store.read()
    const channel = this.requireChannel(settings, channelName)
    const connector = requireConnectorOfType(channel, connectorName, "schedule")
    const index = connector.entries.findIndex((e) => e.id === id)

    if (index < 0) throw new Error(`schedule entry "${id}" not found`)

    connector.entries.splice(index, 1)
    connector.updatedAt = this.clock.iso()
    this.store.write(settings)
  }

  async call(channelName: string, connectorName: string, input: CallInput): Promise<unknown> {
    const connector = this.getConnector(channelName, connectorName)

    if (!connector) {
      throw new Error(`connector "${connectorName}" not found in channel "${channelName}"`)
    }

    const adapter = this.factory.createAdapter(connector)

    if (!adapter) {
      throw new Error(`connector type "${connector.type}" does not support outbound calls`)
    }

    return await adapter.call(input)
  }

  createListener(
    channelName: string,
    connectorName: string,
  ): { config: ConnectorConfig; channelId: string; listener: FunnelConnectorListener } | null {
    const channel = this.get(channelName)

    if (!channel) return null

    const connector = channel.connectors.find((c) => c.name === connectorName)

    if (!connector) return null

    return {
      config: connector,
      channelId: channel.id,
      listener: this.factory.createListener(channel.id, connector),
    }
  }

  createAllListeners(): {
    config: ConnectorConfig
    channelId: string
    channelName: string
    listener: FunnelConnectorListener
  }[] {
    const out: {
      config: ConnectorConfig
      channelId: string
      channelName: string
      listener: FunnelConnectorListener
    }[] = []

    for (const channel of this.list()) {
      for (const connector of channel.connectors) {
        out.push({
          config: connector,
          channelId: channel.id,
          channelName: channel.name,
          listener: this.factory.createListener(channel.id, connector),
        })
      }
    }

    return out
  }

  private requireChannel(settings: Settings, name: string): ChannelConfig {
    const channel = settings.channels.find((c) => c.name === name)

    if (!channel) throw new Error(`channel "${name}" not found`)

    return channel
  }

  private assertNoTokenCollision(settings: Settings, candidate: ConnectorConfig): void {
    const tokens = connectorTokens(candidate)

    if (tokens.length === 0) return

    for (const channel of settings.channels) {
      for (const other of channel.connectors) {
        if (other.id === candidate.id) continue

        for (const token of connectorTokens(other)) {
          if (tokens.includes(token)) {
            throw new Error(
              `token already in use by connector "${other.name}" in channel "${channel.name}"`,
            )
          }
        }
      }
    }
  }
}
