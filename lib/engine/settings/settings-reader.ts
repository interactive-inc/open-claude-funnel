import type { Settings } from "@/engine/settings/settings-schema"

/** Host-owned synchronous configuration. No path, file format or persistence is prescribed. */
export abstract class FunnelSettingsReader {
  /** Return a complete settings object, including its channels array, synchronously or throw. */
  abstract read(): Settings
  abstract write(settings: Settings): void
  /** Apply a synchronous update atomically relative to other writers.
   * Preserve the previous settings when the mutator throws. */
  abstract update<T>(mutator: (settings: Settings) => T): T
}
