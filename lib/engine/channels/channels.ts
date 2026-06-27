import type { CallInput } from "@/engine/connectors/connector-adapter"
import type { BaseConnectorConfig } from "@/engine/connectors/base-connector-config"
import type { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import type { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ProfileChannelChecker } from "@/engine/profiles/profile-channel-checker"
import {
  FunnelChannelAlreadyExistsError,
  FunnelChannelNotFoundError,
  FunnelConnectorNotFoundError,
} from "@/engine/error/funnel-error"
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
  registry: FunnelConnectorRegistry
  profileChecker?: ProfileChannelChecker
  clock?: FunnelClock
  idGenerator?: FunnelIdGenerator
}

export type ChannelConnectorView = BaseConnectorConfig & {
  channelId: string
  channelName: string
}

/**
 * Add-connector input. Core does not enumerate connector types, so the shape is
 * the common pair plus arbitrary type-specific fields — the connector's
 * descriptor (via the registry) builds and validates the concrete config.
 */
export type AddConnectorInput = { type: string; name: string } & Record<string, unknown>

const defaultClock = new NodeFunnelClock()
const defaultIdGenerator = new NodeFunnelIdGenerator()

/**
 * Channels own their connectors. Each channel has a stable id (UUID); the
 * `name` is the human-facing label used by the CLI. Connectors live nested
 * inside `channel.connectors[]`, so add/remove/rename are channel-scoped — no
 * global connector namespace exists. Token uniqueness is enforced across all
 * channels at add/update time so the same Slack/Discord credentials cannot
 * be registered twice.
 *
 * Connector type knowledge lives entirely in the injected registry (descriptors):
 * this class builds, updates, and runs operations on connectors generically and
 * never imports a concrete connector type.
 */
export class FunnelChannels {
  private readonly store: FunnelSettingsReader
  private readonly registry: FunnelConnectorRegistry
  private readonly profileChecker: ProfileChannelChecker | null
  private readonly clock: FunnelClock
  private readonly idGenerator: FunnelIdGenerator

  constructor(deps: Deps) {
    this.store = deps.store
    this.registry = deps.registry
    this.profileChecker = deps.profileChecker ?? null
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

  add(input: { name: string; delivery?: ChannelDeliveryMode }): ChannelConfig {
    return this.store.update((settings) => {
      if (settings.channels.some((c) => c.name === input.name)) {
        throw new FunnelChannelAlreadyExistsError(input.name)
      }

      const channel: ChannelConfig = {
        id: this.idGenerator.generate(),
        name: input.name,
        delivery: input.delivery ?? "fanout",
        connectors: [],
      }

      settings.channels.push(channel)

      return channel
    })
  }

  setDelivery(name: string, delivery: ChannelDeliveryMode): void {
    this.store.update((settings) => {
      const channel = this.requireChannel(settings, name)
      channel.delivery = delivery
    })
  }

  remove(name: string): void {
    this.store.update((settings) => {
      const index = settings.channels.findIndex((c) => c.name === name)

      if (index < 0) throw new FunnelChannelNotFoundError(name)

      const channel = settings.channels[index]

      if (channel && this.profileChecker?.hasChannelRef(channel.id)) {
        throw new Error(`channel "${name}" is referenced by a profile`)
      }

      settings.channels.splice(index, 1)
    })
  }

  rename(oldName: string, newName: string): void {
    this.store.update((settings) => {
      const channel = settings.channels.find((c) => c.name === oldName)

      if (!channel) throw new FunnelChannelNotFoundError(oldName)
      if (settings.channels.some((c) => c.name === newName)) {
        throw new FunnelChannelAlreadyExistsError(newName)
      }

      channel.name = newName
    })
  }

  listConnectors(channelName: string): BaseConnectorConfig[] {
    return this.requireChannel(this.store.read(), channelName).connectors
  }

  getConnector(channelName: string, connectorName: string): BaseConnectorConfig | null {
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

  addConnector(channelName: string, input: AddConnectorInput): BaseConnectorConfig {
    return this.store.update((settings) => {
      const channel = this.requireChannel(settings, channelName)

      if (channel.connectors.some((c) => c.name === input.name)) {
        throw new Error(`connector "${input.name}" already exists in channel "${channelName}"`)
      }

      const candidate = this.registry.buildConfig(input, {
        id: this.idGenerator.generate(),
        now: this.clock.iso(),
      })

      this.assertNoTokenCollision(settings, candidate)

      channel.connectors.push(candidate)

      return candidate
    })
  }

  removeConnector(channelName: string, connectorName: string): void {
    this.store.update((settings) => {
      const channel = this.requireChannel(settings, channelName)
      const index = channel.connectors.findIndex((c) => c.name === connectorName)

      if (index < 0) {
        throw new FunnelConnectorNotFoundError(channelName, connectorName)
      }

      channel.connectors.splice(index, 1)
    })
  }

  renameConnector(channelName: string, oldName: string, newName: string): void {
    this.store.update((settings) => {
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
    })
  }

  /**
   * Update a connector's mutable fields generically. The connector's descriptor
   * rebuilds the config from `fields` (e.g. Slack/Discord token slots are rebuilt
   * so a slot can move between a literal and an env reference cleanly).
   */
  updateConnector(channelName: string, connectorName: string, fields: Record<string, unknown>): void {
    this.store.update((settings) => {
      const channel = this.requireChannel(settings, channelName)
      const connector = channel.connectors.find((c) => c.name === connectorName)

      if (!connector) {
        throw new FunnelConnectorNotFoundError(channelName, connectorName)
      }

      const updated = this.registry.applyUpdate(connector, fields, { now: this.clock.iso() })

      this.assertNoTokenCollision(settings, updated)
      this.replaceConnector(channel, connector.name, updated)
    })
  }

  /** Back-compat wrapper for `updateConnector` on a slack connector. */
  updateSlackConnector(
    channelName: string,
    connectorName: string,
    fields: { botToken?: string; appToken?: string; botTokenEnv?: string; appTokenEnv?: string },
  ): void {
    this.updateConnector(channelName, connectorName, fields)
  }

  /** Back-compat wrapper for `updateConnector` on a gh connector. */
  updateGhConnector(
    channelName: string,
    connectorName: string,
    fields: { pollInterval?: number },
  ): void {
    this.updateConnector(channelName, connectorName, fields)
  }

  /** Back-compat wrapper for `updateConnector` on a discord connector. */
  updateDiscordConnector(
    channelName: string,
    connectorName: string,
    fields: { botToken?: string; botTokenEnv?: string },
  ): void {
    this.updateConnector(channelName, connectorName, fields)
  }

  /**
   * Run a connector-type-specific operation (e.g. schedule `addEntry` /
   * `removeEntry` / `listEntries`). The descriptor returns the next config and a
   * result; the config is persisted only when the operation actually mutated it.
   */
  connectorOp(
    channelName: string,
    connectorName: string,
    operation: string,
    args: unknown,
  ): unknown {
    return this.store.update((settings) => {
      const channel = this.requireChannel(settings, channelName)
      const connector = channel.connectors.find((c) => c.name === connectorName)

      if (!connector) {
        throw new FunnelConnectorNotFoundError(channelName, connectorName)
      }

      const outcome = this.registry.runOperation(connector, operation, args, {
        generateId: () => this.idGenerator.generate(),
        now: this.clock.iso(),
      })

      if (outcome.config !== connector) {
        this.replaceConnector(channel, connector.name, outcome.config)
      }

      return outcome.result
    })
  }

  async call(channelName: string, connectorName: string, input: CallInput): Promise<unknown> {
    const connector = this.getConnector(channelName, connectorName)

    if (!connector) {
      throw new FunnelConnectorNotFoundError(channelName, connectorName)
    }

    const adapter = this.registry.createAdapter(connector)

    if (!adapter) {
      throw new Error(`connector type "${connector.type}" does not support outbound calls`)
    }

    return await adapter.call(input)
  }

  createListener(
    channelName: string,
    connectorName: string,
  ): { config: BaseConnectorConfig; channelId: string; listener: FunnelConnectorListener } | null {
    const channel = this.get(channelName)

    if (!channel) return null

    const connector = channel.connectors.find((c) => c.name === connectorName)

    if (!connector) return null

    return {
      config: connector,
      channelId: channel.id,
      listener: this.registry.createListener(channel.id, connector),
    }
  }

  createAllListeners(): {
    config: BaseConnectorConfig
    channelId: string
    channelName: string
    listener: FunnelConnectorListener
  }[] {
    const out: {
      config: BaseConnectorConfig
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
          listener: this.registry.createListener(channel.id, connector),
        })
      }
    }

    return out
  }

  private requireChannel(settings: Settings, name: string): ChannelConfig {
    const channel = settings.channels.find((c) => c.name === name)

    if (!channel) throw new FunnelChannelNotFoundError(name)

    return channel
  }

  // Swaps a connector for its rebuilt form by array index. Unlike
  // Object.assign onto the live object, this drops keys the new form omits
  // (e.g. a stale literal token when the slot moved to an env reference).
  private replaceConnector(
    channel: ChannelConfig,
    connectorName: string,
    next: BaseConnectorConfig,
  ): void {
    const index = channel.connectors.findIndex((c) => c.name === connectorName)

    if (index < 0) {
      throw new Error(`connector "${connectorName}" not found in channel "${channel.name}"`)
    }

    channel.connectors[index] = next
  }

  private assertNoTokenCollision(settings: Settings, candidate: BaseConnectorConfig): void {
    const tokens = this.registry.secretTokens(candidate)

    if (tokens.length === 0) return

    for (const channel of settings.channels) {
      for (const other of channel.connectors) {
        if (other.id === candidate.id) continue

        for (const token of this.registry.secretTokens(other)) {
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
