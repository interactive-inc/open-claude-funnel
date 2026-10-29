import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"

test("publication resolves and stamps the same captured channel and connector", async () => {
  const funnel = new Funnel({
    store: new MemoryFunnelSettingsStore({
      channels: [
        {
          id: "channel",
          name: "ops",
          delivery: "fanout",
          connectors: [{ id: "connector", type: "test", name: "source" }],
        },
      ],
    }),
  })
  const gateway = funnel.gatewayModule({ token: "" })
  const channel = funnel.channels.get("ops")!
  let channelReads = 0
  let connectorReads = 0
  const stream = gateway.events({ channel: "ops" })
  try {
    gateway.emit({
      get channel() {
        return ++channelReads === 1 ? "ops" : "other"
      },
      get connector() {
        return ++connectorReads === 1 ? "source" : "other"
      },
      content: "input",
    })
    const expected = {
      content: "input",
      offset: 1,
      meta: {
        channel: "ops",
        channelId: channel.id,
        connector: "source",
        connectorId: channel.connectors[0]!.id,
      },
    }
    expect(gateway.getEventLog().loadSince(0)).toEqual([expected])
    expect((await stream.next()).value).toEqual(expected)
    expect(channelReads).toBe(1)
    expect(connectorReads).toBe(1)
  } finally {
    await gateway.stop()
  }
})

test("settings callbacks cannot rewrite a publication's captured content or routing metadata", async () => {
  let onRead = () => {}
  class HostSettings extends MemoryFunnelSettingsStore {
    override read() {
      onRead()
      return super.read()
    }
  }
  const store = new HostSettings({
    channels: [{ id: "channel", name: "ops", delivery: "fanout", connectors: [] }],
  })
  const gateway = new Funnel({ store }).gatewayModule({ token: "" })
  const events = gateway.events({ channel: "ops", subscriberId: "worker" })
  const input = {
    channel: "ops",
    content: "original",
    meta: { target: "worker", detail: "original" },
  }
  onRead = () => {
    input.content = "changed"
    input.meta.target = "other"
    input.meta.detail = "changed"
  }
  try {
    gateway.emit(input)
    const expected = {
      content: "original",
      offset: 1,
      meta: { channel: "ops", channelId: "channel", target: "worker", detail: "original" },
    }
    expect(gateway.getEventLog().loadSince(0)).toEqual([expected])
    expect((await events.next()).value).toEqual(expected)
  } finally {
    onRead = () => {}
    await gateway.stop()
  }
})

test("publication input that initiates shutdown cannot record or deliver an event", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
  try {
    expect(() =>
      gateway.emit({
        channel: "ops",
        get content() {
          gateway.dispose()
          return "input"
        },
      }),
    ).toThrow("gateway is stopped")
    expect(gateway.getBroadcaster().getMetrics().eventsBroadcast).toBe(0)
  } finally {
    await gateway.stop()
  }
})
