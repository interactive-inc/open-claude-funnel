import type { Settings } from "@/engine/settings/settings-schema"

/** Host-owned connection configuration. No path, file format or persistence is prescribed. */
export abstract class FunnelSettingsReader {
  abstract read(): Settings
  abstract write(settings: Settings): void
  /** Apply a synchronous update atomically relative to other writers using this store. */
  abstract update<T>(mutator: (settings: Settings) => T): T
}
