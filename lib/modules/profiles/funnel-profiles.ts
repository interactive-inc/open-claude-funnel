import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import type { ProfileConfig } from "@/modules/settings/settings-schema"

type Deps = {
  store: FunnelSettingsReader
}

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

  add(config: ProfileConfig): void {
    const settings = this.store.read()

    if (settings.profiles.some((p) => p.name === config.name)) {
      throw new Error(`profile "${config.name}" already exists`)
    }

    if (!settings.channels.some((c) => c.name === config.channel)) {
      throw new Error(`channel "${config.channel}" not found`)
    }

    if (config.repo && !settings.repositories.some((r) => r.name === config.repo)) {
      throw new Error(`repo "${config.repo}" not found`)
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

  update(name: string, fields: Partial<Omit<ProfileConfig, "name">>): void {
    const settings = this.store.read()

    const profile = settings.profiles.find((p) => p.name === name)

    if (!profile) throw new Error(`profile "${name}" not found`)

    if (fields.channel !== undefined) {
      if (!settings.channels.some((c) => c.name === fields.channel)) {
        throw new Error(`channel "${fields.channel}" not found`)
      }

      profile.channel = fields.channel
    }

    if (fields.repo !== undefined) {
      if (fields.repo && !settings.repositories.some((r) => r.name === fields.repo)) {
        throw new Error(`repo "${fields.repo}" not found`)
      }

      profile.repo = fields.repo || undefined
    }

    if (fields.subAgent !== undefined) {
      profile.subAgent = fields.subAgent || undefined
    }

    if (fields.envFiles !== undefined) {
      profile.envFiles = fields.envFiles
    }

    this.store.write(settings)
  }
}
