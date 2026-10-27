import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { settingsSchema, type Settings } from "@/engine/settings/settings-schema"

/** In-memory connection configuration. Persistence belongs to the host. */
export class MemoryFunnelSettingsStore extends FunnelSettingsReader {
  private state: Settings
  constructor(initial: Partial<Settings> = {}) {
    super()
    this.state = settingsSchema.parse(initial)
  }
  read(): Settings {
    return this.state
  }
  write(settings: Settings): void {
    this.state = settings
  }
  update<T>(mutator: (settings: Settings) => T): T {
    return mutator(this.state)
  }
}
