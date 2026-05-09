import type { Settings } from "@/engine/settings/settings-schema"

export abstract class FunnelSettingsReader {
  abstract read(): Settings
  abstract write(settings: Settings): void
}
