import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { settingsSchema, type Settings } from "@/engine/settings/settings-schema"

/** In-memory connection configuration. Persistence belongs to the host. */
export class MemoryFunnelSettingsStore extends FunnelSettingsReader {
  private state: Settings
  private writing = false
  constructor(initial: Partial<Settings> = {}) {
    super()
    this.state = snapshot(settingsSchema.parse(initial))
  }
  read(): Settings {
    return snapshot(this.state)
  }
  write(settings: Settings): void {
    this.update((draft) => {
      draft.channels = settings.channels
    })
  }
  update<T>(mutator: (settings: Settings) => T): T {
    if (this.writing) throw new Error("settings update is already in progress")
    this.writing = true
    try {
      const draft = snapshot(this.state)
      const result = mutator(draft)
      if (
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        typeof Reflect.get(result, "then") === "function"
      ) {
        void Promise.resolve(result).catch(() => {})
        throw new Error("settings updates must be synchronous")
      }
      this.state = snapshot(settingsSchema.parse(draft))
      return result
    } finally {
      this.writing = false
    }
  }
}

/** Copy configuration data; opaque host resources keep their original identity. */
function snapshot<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
  if (seen.has(value)) return seen.get(value) as T
  const copy = Array.isArray(value) ? [] : Object.create(prototype)
  if (Array.isArray(value)) copy.length = value.length
  seen.set(value, copy)
  for (const key of Reflect.ownKeys(value)) {
    if (!Object.prototype.propertyIsEnumerable.call(value, key)) continue
    Object.defineProperty(copy, key, {
      value: snapshot(Reflect.get(value, key), seen),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return copy
}
