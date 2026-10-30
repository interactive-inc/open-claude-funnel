import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import type { Settings } from "@/engine/settings/settings-schema"
import type { BaseConnectorConfig } from "@/engine/connectors/base-connector-config"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"

const initial = (): Settings => ({
  channels: [
    {
      id: "ops",
      name: "ops",
      delivery: "fanout",
      connectors: ["first", "second"].map((id) => ({
        id,
        name: id,
        type: "schedule",
        entries: [],
      })),
    },
  ],
})
for (const storage of ["memory", "host"] as const) {
  for (const method of ["update", "operation"] as const) {
    const setup = (inPlace = false, renameOriginal = false) => {
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
      const descriptor = scheduleConnector()
      const change = (config: BaseConnectorConfig, fields: Record<string, unknown>) => {
        if (renameOriginal) config.name = "first"
        return inPlace ? Object.assign(config, fields) : { ...config, ...fields }
      }
      descriptor.applyUpdate = change
      descriptor.operations.change = ({ config, args }) => ({
        config: change(config, args as Record<string, unknown>),
        result: { updated: true },
      })
      const channels = new Funnel({ store, connectors: [descriptor] }).channels
      const run = (fields: Record<string, unknown>) =>
        method === "update"
          ? channels.updateConnector("ops", "second", fields)
          : channels.connectorOp("ops", "second", "change", fields)
      return { store, run }
    }
    for (const inPlace of [false, true]) {
      for (const field of ["id", "name"] as const) {
        test(`${storage} ${method} refuses a duplicate ${field} with inPlace=${inPlace}`, () => {
          const { store, run } = setup(inPlace)
          expect(() => run({ [field]: "first" })).toThrow(
            field === "id"
              ? "connector ID must be non-empty and unique within a channel"
              : 'connector "first" already exists in channel "ops"',
          )
          expect(store.read()).toEqual(initial())
        })
      }
      test(`${storage} ${method} accepts a unique name with inPlace=${inPlace}`, () => {
        const { store, run } = setup(inPlace)
        expect(run({ name: "renamed" })).toEqual(
          method === "update" ? undefined : { updated: true },
        )
        expect(store.read().channels[0]?.connectors.map(({ id, name }) => ({ id, name }))).toEqual([
          { id: "first", name: "first" },
          { id: "second", name: "renamed" },
        ])
      })
    }
    test(`${storage} ${method} replaces the original target even when the hook changes its old name`, () => {
      const { store, run } = setup(false, true)
      run({ name: "renamed" })
      expect(store.read().channels[0]?.connectors.map(({ id, name }) => ({ id, name }))).toEqual([
        { id: "first", name: "first" },
        { id: "second", name: "renamed" },
      ])
    })
    for (const field of ["id", "name"] as const) {
      test(`${storage} ${method} rejects non-string and asynchronous ${field} values`, async () => {
        for (const kind of ["number", "promise", "thenable"] as const) {
          const { store, run } = setup()
          const value =
            kind === "number"
              ? 1
              : kind === "promise"
                ? Promise.resolve("later")
                : {
                    // oxlint-disable-next-line unicorn/no-thenable -- Exercise an asynchronous replacement identity.
                    then(_resolve: unknown, reject: (error: unknown) => void) {
                      reject(new Error("identity unavailable"))
                    },
                  }
          expect(() => run({ [field]: value })).toThrow(
            kind !== "number"
              ? `connector ${field === "id" ? "ID" : "name"} must be synchronous`
              : field === "id"
                ? "connector ID must be non-empty and unique within a channel"
                : "connector name must be a string",
          )
          expect(store.read()).toEqual(initial())
        }
        await Bun.sleep(0)
      })
    }
  }
}
