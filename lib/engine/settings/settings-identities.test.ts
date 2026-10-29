import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { slackConnector } from "@/engine/connectors/slack-connector"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import type { Settings } from "@/engine/settings/settings-schema"

const channel = (id: string, name: string) => ({
  id,
  name,
  delivery: "fanout" as const,
  connectors: [],
})

for (const [channels, message] of [
  [[channel("same", "first"), channel("same", "second")], "channel IDs must be unique"],
  [[channel("first", "same"), channel("second", "same")], "channel names must be unique"],
  [[channel("", "first")], "channel ID must not be empty"],
] as const) {
  test(`invalid stored channel identity is rejected: ${message}`, () => {
    expect(() => new MemoryFunnelSettingsStore({ channels: [...channels] })).toThrow(message)
  })
}

test("invalid connector identities are rejected within each channel", () => {
  const first = { id: "connector", type: "custom", name: "first" }
  for (const [second, message] of [
    [{ ...first, name: "second" }, "connector IDs must be unique within a channel"],
    [{ ...first, id: "second" }, "connector names must be unique within a channel"],
    [{ ...first, id: "", name: "second" }, "connector ID must not be empty"],
  ] as const) {
    expect(
      () =>
        new MemoryFunnelSettingsStore({
          channels: [
            {
              ...channel("channel", "ops"),
              connectors: [first, second],
            },
          ],
        }),
    ).toThrow(message)
  }
})

class HostStore extends FunnelSettingsReader {
  constructor(public state: Settings) {
    super()
  }
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

test("malformed host settings cannot attach a subscription to another channel's ID", () => {
  const store = new HostStore({ channels: [channel("same", "first"), channel("same", "second")] })
  const funnel = new Funnel({ store })
  expect(() => funnel.gatewayModule({ token: "" }).events({ channel: "second" })).toThrow(
    "channel IDs must be unique",
  )
})

test("host identity corruption after subscription is rejected before publication", async () => {
  const store = new HostStore({
    channels: [channel("first", "first"), channel("second", "second")],
  })
  const gateway = new Funnel({ store }).gatewayModule({ token: "" })
  const subscription = gateway.events({ channel: "second" })
  try {
    store.state.channels[1]!.id = "first"
    expect(() => gateway.emit({ channel: "first", content: "private input" })).toThrow(
      "channel IDs must be unique",
    )
    expect(gateway.getBroadcaster().getMetrics().eventsBroadcast).toBe(0)
    const read = subscription.next()
    await subscription.return()
    expect(await read).toEqual({ done: true, value: undefined })
  } finally {
    await gateway.stop()
  }
})

test("a colliding generated channel ID is rejected before mutating a host store", () => {
  const store = new HostStore({ channels: [channel("existing", "first")] })
  const channels = new FunnelChannels({
    store,
    registry: new FunnelConnectorRegistry({ descriptors: [] }),
    idGenerator: { generate: () => "existing" },
  })
  expect(() => channels.add({ name: "second" })).toThrow("channel ID must be non-empty and unique")
  expect(store.state.channels).toEqual([channel("existing", "first")])
})

test("invalid generated connector IDs are rejected before mutating a host store", () => {
  const connector = {
    id: "existing",
    type: "slack",
    name: "first",
    botToken: "xoxb-first",
    appToken: "xapp-first",
  }
  for (const id of ["", "existing"]) {
    const state = { channels: [{ ...channel("channel", "ops"), connectors: [connector] }] }
    const store = new HostStore(structuredClone(state))
    const channels = new FunnelChannels({
      store,
      registry: new FunnelConnectorRegistry({ descriptors: [slackConnector()] }),
      idGenerator: { generate: () => id },
    })
    expect(() =>
      channels.addConnector("ops", {
        type: "slack",
        name: "second",
        botToken: "xoxb-second",
        appToken: "xapp-second",
      }),
    ).toThrow("connector ID must be non-empty and unique within a channel")
    expect(store.state).toEqual(state)
  }
})

test("connector identity uniqueness is scoped to its owning channel", () => {
  const connector = { id: "shared", type: "custom", name: "source" }
  const store = new MemoryFunnelSettingsStore({
    channels: [
      { ...channel("first", "first"), connectors: [connector] },
      { ...channel("second", "second"), connectors: [connector] },
    ],
  })
  expect(store.read().channels).toHaveLength(2)
})
