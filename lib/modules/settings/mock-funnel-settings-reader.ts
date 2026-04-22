import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import type { Settings } from "@/modules/settings/settings-schema"

export const createSettings = (partial: Partial<Settings> = {}): Settings => ({
  channels: [],
  repositories: [],
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
}
