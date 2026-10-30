import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import type { Settings } from "@/engine/settings/settings-schema"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"

const initial = (): Settings => ({
  channels: [{ id: "ops", name: "ops", delivery: "fanout", connectors: [] }],
})
for (const storage of ["memory", "host"] as const) {
  for (const field of ["id", "name"] as const) {
    for (const kind of ["number", "resolved", "rejected", "hidden", "thenable"] as const) {
      test(`${storage} creation rejects a ${kind} connector ${field} before checking credentials`, async () => {
        class Store extends FunnelSettingsReader {
          state = initial()
          read() {
            return structuredClone(this.state)
          }
          write(settings: Settings) {
            this.state = structuredClone(settings)
          }
          update<T>(mutator: (settings: Settings) => T): T {
            const draft = this.read()
            const result = mutator(draft)
            this.write(draft)
            return result
          }
        }
        const store = storage === "memory" ? new MemoryFunnelSettingsStore(initial()) : new Store()
        const failure = new Error("identity unavailable")
        const value =
          kind === "number"
            ? 1
            : kind === "thenable"
              ? {
                  // oxlint-disable-next-line unicorn/no-thenable -- Exercise an asynchronous host identity.
                  then(_resolve: unknown, reject: (error: unknown) => void) {
                    reject(failure)
                  },
                }
              : kind === "resolved"
                ? Promise.resolve("later")
                : Promise.reject(failure)
        if (value instanceof Promise) {
          // The baseline must be safe while checking the earlier validation boundary.
          void value.catch(() => {})
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise hiding its then method.
          if (kind === "hidden") Object.defineProperty(value, "then", { value: undefined })
        }
        const descriptor = scheduleConnector()
        const build = descriptor.buildConfig
        let invalid = true
        let credentials = 0
        descriptor.buildConfig = (input, context) => {
          const config = build(input, context)
          return invalid ? { ...config, [field]: value } : config
        }
        descriptor.secretTokens = () => {
          credentials++
          return []
        }
        const channels = new Funnel({ store, connectors: [descriptor] }).channels
        expect(() => channels.addConnector("ops", { type: "schedule", name: "new" })).toThrow(
          kind !== "number"
            ? `connector ${field === "id" ? "ID" : "name"} must be synchronous`
            : field === "id"
              ? "connector ID must be non-empty and unique within a channel"
              : "connector name must be a string",
        )
        expect(credentials).toBe(0)
        expect(store.read()).toEqual(initial())
        invalid = false
        expect(channels.addConnector("ops", { type: "schedule", name: "new" })).toMatchObject({
          name: "new",
          type: "schedule",
        })
        expect(credentials).toBe(1)
        expect(store.read().channels[0]?.connectors).toHaveLength(1)
        await Bun.sleep(0)
      })
    }
  }
}
