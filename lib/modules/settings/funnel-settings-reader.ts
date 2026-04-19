import type { Settings } from "@/modules/settings/settings-schema"

export abstract class FunnelSettingsReader {
  abstract read(): Settings
  abstract write(settings: Settings): void
}
