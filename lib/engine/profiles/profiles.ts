import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import type { ProfileConfig } from "@/engine/settings/settings-schema"

type Deps = {
  store: FunnelSettingsReader
}

/**
 * Named launch presets for `fnl claude`. Each profile bundles a working
 * directory, a sub-agent name, and the channel id its Claude instance will
 * subscribe to. Implements ProfileChannelChecker so FunnelChannels can refuse
 * to remove a channel that is still referenced.
 *
 * The first entry in the persisted array is treated as the default profile;
 * `asDefault` reorders the array to put a named profile first.
 *
 * `channelId` always stores the channel's stable id (uuid). CLI surfaces
 * resolve channel name → id before calling `add`/`update` here.
 */
export class FunnelProfiles {
  private readonly store: FunnelSettingsReader

  constructor(deps: Deps) {
    this.store = deps.store
    Object.freeze(this)
  }

  list(): ProfileConfig[] {
    return this.store.read().profiles
  }

  get(name: string): ProfileConfig | null {
    return this.list().find((p) => p.name === name) ?? null
  }

  getDefault(): ProfileConfig | null {
    return this.list()[0] ?? null
  }

  add(config: ProfileConfig): void {
    const settings = this.store.read()

    if (settings.profiles.some((p) => p.name === config.name)) {
      throw new Error(`profile "${config.name}" already exists`)
    }

    if (!settings.channels.some((c) => c.id === config.channelId)) {
      throw new Error(`channel id "${config.channelId}" not found`)
    }

    settings.profiles.push(config)

    this.store.write(settings)
  }

  remove(name: string): void {
    const settings = this.store.read()

    const index = settings.profiles.findIndex((p) => p.name === name)

    if (index < 0) throw new Error(`profile "${name}" not found`)

    settings.profiles.splice(index, 1)

    this.store.write(settings)
  }

  rename(oldName: string, newName: string): void {
    const settings = this.store.read()

    const profile = settings.profiles.find((p) => p.name === oldName)

    if (!profile) throw new Error(`profile "${oldName}" not found`)

    if (settings.profiles.some((p) => p.name === newName)) {
      throw new Error(`profile "${newName}" already exists`)
    }

    profile.name = newName

    this.store.write(settings)
  }

  asDefault(name: string): void {
    const settings = this.store.read()

    const index = settings.profiles.findIndex((p) => p.name === name)

    if (index < 0) throw new Error(`profile "${name}" not found`)

    if (index === 0) return

    const [profile] = settings.profiles.splice(index, 1)

    if (!profile) return

    settings.profiles.unshift(profile)

    this.store.write(settings)
  }

  hasChannelRef(channelId: string): boolean {
    return this.store.read().profiles.some((p) => p.channelId === channelId)
  }

  update(name: string, fields: Partial<Omit<ProfileConfig, "name">>): void {
    const settings = this.store.read()

    const profile = settings.profiles.find((p) => p.name === name)

    if (!profile) throw new Error(`profile "${name}" not found`)

    if (fields.channelId !== undefined) {
      if (!settings.channels.some((c) => c.id === fields.channelId)) {
        throw new Error(`channel id "${fields.channelId}" not found`)
      }

      profile.channelId = fields.channelId
    }

    if (fields.path !== undefined) profile.path = fields.path
    if (fields.subAgent !== undefined) profile.subAgent = fields.subAgent

    this.store.write(settings)
  }
}
