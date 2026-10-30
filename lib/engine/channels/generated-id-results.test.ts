import { expect, test } from "bun:test"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import type { Settings } from "@/engine/settings/settings-schema"
import type { FunnelIdGenerator } from "@/engine/id/id-generator"

type Path = "channel" | "connector" | "entry"
const setup = (path: Path, idGenerator: FunnelIdGenerator) => {
  const initial: Settings = {
    channels:
      path === "channel"
        ? []
        : [
            {
              id: "ops",
              name: "ops",
              delivery: "fanout",
              connectors:
                path === "entry"
                  ? [{ id: "source", name: "source", type: "schedule", entries: [] }]
                  : [],
            },
          ],
  }
  class Store extends FunnelSettingsReader {
    state = structuredClone(initial)
    read() {
      return this.state
    }
    write(settings: Settings) {
      this.state = settings
    }
    update<T>(mutator: (settings: Settings) => T): T {
      return mutator(this.state)
    }
  }
  const store = new Store()
  const channels = new FunnelChannels({
    store,
    registry: new FunnelConnectorRegistry({ descriptors: [scheduleConnector()] }),
    idGenerator,
  })
  const operation = () =>
    path === "channel"
      ? channels.add({ name: "new" })
      : path === "connector"
        ? channels.addConnector("ops", { name: "source", type: "schedule" })
        : channels.connectorOp("ops", "source", "addEntry", {
            runAt: "1970-01-01T00:00:00.000Z",
            prompt: "input",
          })
  return { store, initial, operation }
}

for (const path of ["channel", "connector", "entry"] as const) {
  for (const kind of ["resolved", "rejected", "hidden-then", "thenable"] as const) {
    test(`${path} rejects a ${kind} generated ID before changing host settings and can recover`, async () => {
      let invalid = true
      let calls = 0
      class Generator {
        #id = "generated"
        generate(): string {
          calls++
          if (!invalid) return this.#id
          if (kind === "thenable")
            return {
              // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied asynchronous ID generator.
              then(_resolve: unknown, reject: (error: unknown) => void) {
                reject(new Error("generator unavailable"))
              },
            } as never
          const value =
            kind === "resolved"
              ? Promise.resolve("generated")
              : Promise.reject(new Error("generator unavailable"))
          void value.catch(() => {})
          if (kind === "hidden-then") {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden method.
            Object.defineProperty(value, "then", { value: undefined })
          }
          return value as never
        }
      }
      const { store, initial, operation } = setup(path, new Generator())
      expect(operation).toThrow("ID generation must be synchronous")
      expect(store.read()).toEqual(initial)
      invalid = false
      expect(operation()).toMatchObject({ id: "generated" })
      expect(calls).toBe(2)
      await Bun.sleep(0)
    })
  }
  test(`${path} refuses non-string generated IDs before changing host settings`, () => {
    for (const value of [1, null, undefined, {}, false]) {
      const { store, initial, operation } = setup(path, { generate: () => value as never })
      expect(operation).toThrow("generated ID must be a string")
      expect(store.read()).toEqual(initial)
    }
  })
}
