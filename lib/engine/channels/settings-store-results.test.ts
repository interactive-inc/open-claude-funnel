import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import type { Settings } from "@/engine/settings/settings-schema"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"

const initial = (): Settings => ({
  channels: [
    {
      id: "ops",
      name: "ops",
      delivery: "fanout",
      connectors: [{ id: "source", name: "source", type: "schedule", entries: [] }],
    },
  ],
})

for (const method of ["read", "update"] as const) {
  for (const kind of ["resolved", "rejected", "hidden-then", "thenable"] as const) {
    test(`settings ${method} rejects a ${kind} asynchronous store result and can recover`, async () => {
      let invalid = true
      const bad = (): unknown => {
        if (kind === "thenable")
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied asynchronous settings store.
            then(_resolve: unknown, reject: (error: unknown) => void) {
              reject(new Error("store unavailable"))
            },
          }
        const value =
          kind === "resolved"
            ? Promise.resolve(initial())
            : Promise.reject(new Error("store unavailable"))
        void value.catch(() => {})
        if (kind === "hidden-then") {
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden method.
          Object.defineProperty(value, "then", { value: undefined })
        }
        return value
      }
      class Store extends FunnelSettingsReader {
        #memory = new MemoryFunnelSettingsStore(initial())
        read(): Settings {
          return invalid && method === "read" ? (bad() as never) : this.#memory.read()
        }
        write(settings: Settings): void {
          this.#memory.write(settings)
        }
        update<T>(mutator: (settings: Settings) => T): T {
          return invalid && method === "update" ? (bad() as T) : this.#memory.update(mutator)
        }
      }
      const store = new Store()
      const funnel = new Funnel({ store, connectors: [scheduleConnector()] })
      if (method === "read") {
        expect(() => funnel.channels.list()).toThrow("settings read must be synchronous")
        const gateway = funnel.gatewayModule({ token: "" })
        try {
          const response = await gateway.app.request("/debug")
          expect(response.status).toBe(500)
          expect(await response.json()).toEqual({ error: "settings read must be synchronous" })
        } finally {
          await gateway.stop()
        }
      } else {
        const operations = [
          () => funnel.channels.add({ name: "new" }),
          () => funnel.channels.setDelivery("ops", "exclusive"),
          () => funnel.channels.remove("ops"),
          () => funnel.channels.rename("ops", "new"),
          () => funnel.channels.addConnector("ops", { name: "new", type: "schedule" }),
          () => funnel.channels.removeConnector("ops", "source"),
          () => funnel.channels.renameConnector("ops", "source", "new"),
          () => funnel.channels.updateConnector("ops", "source", {}),
          () => funnel.channels.connectorOp("ops", "source", "listEntries", undefined),
        ]
        for (const operation of operations)
          expect(operation).toThrow("settings update must be synchronous")
        expect(store.read()).toEqual(initial())
      }
      await Bun.sleep(0)
      invalid = false
      expect(funnel.channels.list()).toEqual(initial().channels)
      funnel.channels.rename("ops", "renamed")
      expect(store.read().channels[0]?.name).toBe("renamed")
    })
  }
}

for (const [kind, value] of [
  ["missing", {}],
  ["undefined", { channels: undefined }],
] as const) {
  test(`settings read cannot substitute empty configuration for a ${kind} channels array`, () => {
    class Store extends MemoryFunnelSettingsStore {
      override read(): Settings {
        return value as never
      }
    }
    const funnel = new Funnel({ store: new Store() })
    expect(() => funnel.channels.list()).toThrow()
  })
}

for (const kind of ["resolved", "rejected", "thenable"] as const) {
  test(`a ${kind} operation result is refused before a host store commits the draft`, async () => {
    class Store extends FunnelSettingsReader {
      #memory = new MemoryFunnelSettingsStore(initial())
      read() {
        return this.#memory.read()
      }
      write(settings: Settings) {
        this.#memory.write(settings)
      }
      update<T>(mutator: (settings: Settings) => T): T {
        const draft = this.read()
        const result = mutator(draft)
        this.write(draft)
        return result
      }
    }
    const descriptor = scheduleConnector()
    descriptor.operations.pending = ({ config }) => {
      config.name = "changed"
      let result: unknown
      if (kind === "thenable")
        result = {
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise an asynchronous operation result.
          then(_resolve: unknown, reject: (error: unknown) => void) {
            reject(new Error("operation unavailable"))
          },
        }
      else {
        const promise =
          kind === "resolved"
            ? Promise.resolve("later")
            : Promise.reject(new Error("operation unavailable"))
        void promise.catch(() => {})
        result = promise
      }
      return { config, result }
    }
    const store = new Store()
    const funnel = new Funnel({ store, connectors: [descriptor] })
    expect(() => funnel.channels.connectorOp("ops", "source", "pending", undefined)).toThrow(
      "settings updates must be synchronous",
    )
    expect(store.read()).toEqual(initial())
    await Bun.sleep(0)
  })
}
