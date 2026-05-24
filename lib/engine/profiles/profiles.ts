import { FunnelIdGenerator } from "@/engine/id/id-generator"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import type { ProfileConfig } from "@/engine/settings/settings-schema"

type Deps = {
  store: FunnelSettingsReader
  idGenerator: FunnelIdGenerator
}

/**
 * Named launch presets for `fnl claude`. Each profile bundles a working
 * directory, the channel id its Claude instance subscribes to, and the launch
 * recipe (`options` prepended to the claude argv, `env` layered under the
 * process, `resume` toggling session reuse). Implements ProfileChannelChecker
 * so FunnelChannels can refuse to remove a channel that is still referenced.
 *
 * Each profile has a stable `id` (uuid) minted at `add`. That id is the unit
 * everything internal keys on — the PID file, the resumable session id — so a
 * rename never strands either. `name` is purely the CLI/TUI handle; the CRUD
 * methods here take it because that is what the user types, but resolve to the
 * id before touching id-keyed state. The first array entry is the default
 * profile; `asDefault` reorders to put one first.
 *
 * `channelId` always stores the channel's stable id (uuid). CLI surfaces
 * resolve channel name → id before calling `add`/`update` here.
 */
export class FunnelProfiles {
  private readonly store: FunnelSettingsReader
  private readonly idGenerator: FunnelIdGenerator

  constructor(deps: Deps) {
    this.store = deps.store
    this.idGenerator = deps.idGenerator
    Object.freeze(this)
  }

  list(): ProfileConfig[] {
    return this.store.read().profiles
  }

  get(name: string): ProfileConfig | null {
    return this.list().find((p) => p.name === name) ?? null
  }

  getById(id: string): ProfileConfig | null {
    return this.list().find((p) => p.id === id) ?? null
  }

  getDefault(): ProfileConfig | null {
    return this.list()[0] ?? null
  }

  add(input: {
    name: string
    path: string
    channelId: string
    options?: string[]
    env?: Record<string, string>
    resume?: boolean
  }): void {
    const settings = this.store.read()

    if (settings.profiles.some((p) => p.name === input.name)) {
      throw new Error(`profile "${input.name}" already exists`)
    }

    if (!settings.channels.some((c) => c.id === input.channelId)) {
      throw new Error(`channel id "${input.channelId}" not found`)
    }

    settings.profiles.push({
      id: this.idGenerator.generate(),
      name: input.name,
      path: input.path,
      channelId: input.channelId,
      options: input.options ?? [],
      env: input.env ?? {},
      resume: input.resume ?? true,
    })

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

  /** Resumable claude session id last launched by this profile (by id), or null. */
  getSessionId(id: string): string | null {
    return this.getById(id)?.sessionId ?? null
  }

  /** Records the claude session id this profile launched, overwriting any prior one. */
  setSessionId(id: string, sessionId: string): void {
    const settings = this.store.read()

    const profile = settings.profiles.find((p) => p.id === id)

    if (!profile) throw new Error(`profile id "${id}" not found`)

    profile.sessionId = sessionId

    this.store.write(settings)
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

    if (fields.options !== undefined) profile.options = fields.options

    if (fields.env !== undefined) profile.env = fields.env

    if (fields.resume !== undefined) profile.resume = fields.resume

    this.store.write(settings)
  }
}
