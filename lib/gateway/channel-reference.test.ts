import { expect, test } from "bun:test"
import type { Server } from "bun"
import { Funnel } from "@/funnel"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import type { GatewayWsData } from "@/gateway/gateway-module"

const setup = (token = "") =>
  new Funnel({
    store: new MemoryFunnelSettingsStore({
      channels: [
        { id: "first-id", name: "ops", delivery: "fanout", connectors: [] },
        { id: "second-id", name: "first-id", delivery: "fanout", connectors: [] },
      ],
    }),
  }).gatewayModule({ token })

test("ambiguous native subscriptions and publications fail before choosing a channel", async () => {
  const gateway = setup()
  try {
    expect(() => gateway.events({ channel: "first-id" })).toThrow("ambiguous channel reference")
    expect(() => gateway.emit({ channel: "first-id", content: "private input" })).toThrow(
      "ambiguous channel reference",
    )
    expect(gateway.getBroadcaster().getMetrics()).toMatchObject({
      subscribers: 0,
      eventsBroadcast: 0,
    })
  } finally {
    await gateway.stop()
  }
})

test("ambiguous HTTP publication returns a client error without recording an event", async () => {
  const gateway = setup()
  try {
    const response = await gateway.app.request("/channels/first-id/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "private input" }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "ambiguous channel reference: first-id" })
    expect(gateway.getEventLog().loadSince(0)).toEqual([])
  } finally {
    await gateway.stop()
  }
})

test("ambiguous WebSocket subscriptions are rejected before upgrade", async () => {
  const gateway = setup()
  let upgrades = 0
  const server = {
    upgrade() {
      upgrades++
      return true
    },
  } as unknown as Server<GatewayWsData>
  try {
    const result = gateway.handleUpgrade(
      new Request("http://localhost/ws?channel=first-id", {
        headers: { upgrade: "websocket" },
      }),
      server,
    )
    expect(result.handled && result.response?.status).toBe(400)
    expect(upgrades).toBe(0)
  } finally {
    await gateway.stop()
  }
})

test("unambiguous names and IDs still route to separate channels", async () => {
  const gateway = setup()
  try {
    const first = gateway.events({ channel: "ops" })
    const second = gateway.events({ channel: "second-id" })
    gateway.emit({ channel: "ops", content: "first" })
    gateway.emit({ channel: "second-id", content: "second" })
    expect((await first.next()).value.content).toBe("first")
    expect((await second.next()).value.content).toBe("second")
  } finally {
    await gateway.stop()
  }
})

test("matching a channel's own name and ID remains unambiguous", async () => {
  const gateway = new Funnel({
    store: new MemoryFunnelSettingsStore({
      channels: [{ id: "same", name: "same", delivery: "fanout", connectors: [] }],
    }),
  }).gatewayModule({ token: "" })
  try {
    const stream = gateway.events({ channel: "same" })
    gateway.emit({ channel: "same", content: "self match" })
    expect((await stream.next()).value.content).toBe("self match")
  } finally {
    await gateway.stop()
  }
})

test("authentication is checked before reporting ambiguous HTTP or WebSocket references", async () => {
  const gateway = setup("example-token")
  const server = {
    upgrade() {
      throw new Error("Unauthorized upgrade")
    },
  } as unknown as Server<GatewayWsData>
  try {
    const response = await gateway.app.request("/channels/first-id/publish", { method: "POST" })
    expect(response.status).toBe(401)
    const result = gateway.handleUpgrade(
      new Request("http://localhost/ws?channel=first-id", {
        headers: { upgrade: "websocket" },
      }),
      server,
    )
    expect(result.handled && result.response?.status).toBe(401)
  } finally {
    await gateway.stop()
  }
})
