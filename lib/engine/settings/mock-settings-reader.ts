import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { SETTINGS_VERSION } from "@/engine/settings/settings-schema"
import type { Settings } from "@/engine/settings/settings-schema"

export const createSettings = (partial: Partial<Settings> = {}): Settings => ({
  version: SETTINGS_VERSION,
  channels: [],
  profiles: [],
  ...partial,
})

export class MockFunnelSettingsReader extends FunnelSettingsReader {
  private state: Settings

  constructor(initial?: Partial<Settings>) {
    super()
    this.state = createSettings(initial)
  }

  read(): Settings {
    return this.state
  }

  write(settings: Settings): void {
    this.state = settings
  }

  update<T>(mutator: (settings: Settings) => T): T {
    const result = mutator(this.state)
    return result
  }
}
