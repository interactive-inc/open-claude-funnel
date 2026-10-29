import { expect, test } from "bun:test"
import type { Server } from "bun"
import { Funnel } from "@/funnel"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import type { Settings } from "@/engine/settings/settings-schema"
import type { GatewayEventsOptions, GatewayWsData } from "@/gateway/gateway-module"

class Store extends FunnelSettingsReader {
  onRead: (() => void) | undefined
  state: Settings = { channels: [{ id: "ops", name: "ops", delivery: "fanout", connectors: [] }] }
  read() {
    const callback = this.onRead
    this.onRead = undefined
    callback?.()
    return this.state
  }
  write(settings: Settings) {
    this.state = settings
  }
  update<T>(mutator: (settings: Settings) => T): T {
    return mutator(this.state)
  }
}

for (const action of ["stop", "dispose", "abort"] as const) {
  test(`${action} during channel lookup prevents native subscription registration`, async () => {
    const store = new Store()
    const controller = new AbortController()
    const gateway = new Funnel({ store, signal: controller.signal }).gatewayModule({ token: "" })
    store.onRead = () => {
      if (action === "stop") void gateway.stop()
      else if (action === "dispose") gateway.dispose()
      else controller.abort()
    }
    try {
      expect(() => gateway.events({ channel: "ops" })).toThrow("gateway is stopped")
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    } finally {
      await gateway.stop()
    }
  })
}

test("shutdown during channel lookup prevents WebSocket upgrade", async () => {
  const store = new Store()
  const gateway = new Funnel({ store }).gatewayModule({ token: "" })
  let upgrades = 0
  const server = {
    upgrade() {
      upgrades++
      return true
    },
  } as unknown as Server<GatewayWsData>
  store.onRead = () => {
    void gateway.stop()
  }
  try {
    const result = gateway.handleUpgrade(
      new Request("http://localhost/ws?channel=ops", { headers: { upgrade: "websocket" } }),
      server,
    )
    expect(result.handled && result.response?.status).toBe(503)
    expect(upgrades).toBe(0)
  } finally {
    await gateway.stop()
  }
})

for (const field of [
  "subscriberId",
  "since",
  "signal",
  "maxQueuedEvents",
  "maxQueuedBytes",
] as const) {
  test(`shutdown from subscription ${field} cannot leave a new registered stream`, async () => {
    const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
    const values = {
      subscriberId: "worker",
      since: 0,
      signal: undefined,
      maxQueuedEvents: 10,
      maxQueuedBytes: 1024,
    }
    const options: GatewayEventsOptions = { channel: "ops" }
    Object.defineProperty(options, field, {
      get() {
        void gateway.stop()
        return values[field]
      },
    })
    try {
      expect(() => gateway.events(options)).toThrow("gateway is stopped")
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    } finally {
      await gateway.stop()
    }
  })
}
