import type { Settings } from "@/engine/settings/settings-schema"

export abstract class FunnelSettingsReader {
  abstract read(): Settings
  abstract write(settings: Settings): void
  /**
   * Atomic read-modify-write. Implementations must serialize against
   * concurrent processes touching the same file (the Node store does so via
   * an exclusive lockfile; Memory stores are single-threaded). Engine
   * classes must use `update` for any mutation that depends on prior state,
   * otherwise a concurrent CLI invocation or `fnl claude` launch can lose
   * the edit through a read-modify-write race.
   */
  abstract update<T>(mutator: (settings: Settings) => T): T
}
