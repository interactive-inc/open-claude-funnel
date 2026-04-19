import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import type { ChannelConfig } from "@/modules/settings/settings-schema"

type Deps = {
  store: FunnelSettingsReader
}

export class FunnelChannels {
  private readonly store: FunnelSettingsReader

  constructor(deps: Deps) {
    this.store = deps.store
    Object.freeze(this)
  }

  list(): ChannelConfig[] {
    return this.store.read().channels
  }

  get(name: string): ChannelConfig | null {
    return this.list().find((c) => c.name === name) ?? null
  }

  add(config: ChannelConfig): void {
    const settings = this.store.read()

    if (settings.channels.some((c) => c.name === config.name)) {
      throw new Error(`channel "${config.name}" already exists`)
    }

    for (const connectorName of config.connectors) {
      if (!settings.connectors.some((c) => c.name === connectorName)) {
        throw new Error(`connector "${connectorName}" not found`)
      }
    }

    settings.channels.push(config)

    this.store.write(settings)
  }

  remove(name: string): void {
    const settings = this.store.read()

    const index = settings.channels.findIndex((c) => c.name === name)

    if (index < 0) throw new Error(`channel "${name}" not found`)

    if (settings.profiles.some((p) => p.channel === name)) {
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

    for (const profile of settings.profiles) {
      if (profile.channel === oldName) profile.channel = newName
    }

    this.store.write(settings)
  }

  attachConnector(name: string, connectorName: string): void {
    const settings = this.store.read()

    const channel = settings.channels.find((c) => c.name === name)

    if (!channel) throw new Error(`channel "${name}" not found`)

    if (!settings.connectors.some((c) => c.name === connectorName)) {
      throw new Error(`connector "${connectorName}" not found`)
    }

    if (channel.connectors.includes(connectorName)) {
      throw new Error(`connector "${connectorName}" is already attached`)
    }

    channel.connectors.push(connectorName)

    this.store.write(settings)
  }

  detachConnector(name: string, connectorName: string): void {
    const settings = this.store.read()

    const channel = settings.channels.find((c) => c.name === name)

    if (!channel) throw new Error(`channel "${name}" not found`)

    const index = channel.connectors.indexOf(connectorName)

    if (index < 0) throw new Error(`connector "${connectorName}" is not attached`)

    channel.connectors.splice(index, 1)

    this.store.write(settings)
  }
}
