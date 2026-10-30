import { expect, test } from "bun:test"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import type { Settings } from "@/engine/settings/settings-schema"

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
for (const storage of ["memory", "host"] as const) {
  const setup = () => {
    class Store extends FunnelSettingsReader {
      state = initial()
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
    const store = storage === "memory" ? new MemoryFunnelSettingsStore(initial()) : new Store()
    const descriptor = scheduleConnector()
    const registry = new FunnelConnectorRegistry({ descriptors: [descriptor] })
    const channels = new FunnelChannels({ store, registry })
    return { store, descriptor, registry, channels }
  }
  test(`${storage} channel creation checks and stores the same name snapshot`, () => {
    const { store, channels } = setup()
    let names = 0
    let deliveries = 0
    expect(
      channels.add({
        get name() {
          return ++names === 1 ? "new" : "ops"
        },
        get delivery() {
          deliveries++
          return "fanout" as const
        },
      }),
    ).toMatchObject({ name: "new", delivery: "fanout" })
    expect(store.read().channels.map((channel) => channel.name)).toEqual(["ops", "new"])
    expect(names).toBe(1)
    expect(deliveries).toBe(1)
  })
  test(`${storage} ID callbacks cannot rewrite the checked channel name or delivery`, () => {
    const { store, registry } = setup()
    const input: { name: string; delivery: "fanout" | "exclusive" } = {
      name: "new",
      delivery: "fanout",
    }
    const channels = new FunnelChannels({
      store,
      registry,
      idGenerator: {
        generate() {
          input.name = "ops"
          input.delivery = "exclusive"
          return "generated"
        },
      },
    })
    expect(channels.add(input)).toMatchObject({ id: "generated", name: "new", delivery: "fanout" })
    expect(store.read().channels.map((channel) => channel.name)).toEqual(["ops", "new"])
  })
  test(`${storage} a duplicate channel does not read an unused delivery option`, () => {
    const { store, channels } = setup()
    expect(() =>
      channels.add({
        name: "ops",
        get delivery(): "fanout" {
          throw new Error("unused delivery was read")
        },
      }),
    ).toThrow("channel already exists: ops")
    expect(store.read()).toEqual(initial())
  })
  test(`${storage} connector creation rejects a normalized name that already exists`, () => {
    const { store, descriptor, channels } = setup()
    const build = descriptor.buildConfig
    descriptor.buildConfig = (input, context) =>
      build({ ...input, name: String(input.name).toLowerCase() }, context)
    expect(() => channels.addConnector("ops", { type: "schedule", name: "SOURCE" })).toThrow(
      'connector "source" already exists in channel "ops"',
    )
    expect(store.read()).toEqual(initial())
  })
  test(`${storage} connector creation accepts a unique normalized name`, () => {
    const { store, descriptor, channels } = setup()
    const build = descriptor.buildConfig
    descriptor.buildConfig = (input, context) =>
      build({ ...input, name: String(input.name).toLowerCase() }, context)
    expect(channels.addConnector("ops", { type: "schedule", name: "OTHER" })).toMatchObject({
      name: "other",
    })
    expect(store.read().channels[0]?.connectors.map((connector) => connector.name)).toEqual([
      "source",
      "other",
    ])
  })
  test(`${storage} connector creation rechecks the name produced from a changing input`, () => {
    const { store, channels } = setup()
    let names = 0
    expect(() =>
      channels.addConnector("ops", {
        type: "schedule",
        get name() {
          return ++names === 1 ? "new" : "source"
        },
      }),
    ).toThrow('connector "source" already exists in channel "ops"')
    expect(store.read()).toEqual(initial())
    expect(names).toBe(2)
  })
  test(`${storage} a duplicate connector name is not read again to build its error`, () => {
    const { store, channels } = setup()
    let names = 0
    expect(() =>
      channels.addConnector("ops", {
        type: "schedule",
        get name() {
          if (++names > 1) throw new Error("name read again")
          return "source"
        },
      }),
    ).toThrow('connector "source" already exists in channel "ops"')
    expect(names).toBe(1)
    expect(store.read()).toEqual(initial())
  })
}
