import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"

test("prototype config fields remain available when stopping an orphaned listener", async () => {
  class Config {
    get id() {
      return "source"
    }
    get name() {
      return "source"
    }
    get type() {
      return "source"
    }
  }
  const configured = [
    { id: "source", name: "source", type: "source", channelId: "channel", channelName: "channel" },
  ]
  let stops = 0
  const registry = new FunnelListenerRegistry({
    channels: {
      listAllConnectors: () => configured,
      createListener: () => ({
        config: new Config(),
        channelId: "channel",
        listener: {
          async start() {},
          async stop() {
            stops++
          },
          isAlive: () => true,
          isConnected: () => true,
        },
      }),
    },
    notify: async () => {},
  })
  try {
    expect((await registry.start("channel", "source")).ok).toBe(true)
    configured.length = 0
    expect(registry.list()).toMatchObject([{ name: "source", type: "source" }])
    expect((await registry.stop("channel", "source")).ok).toBe(true)
    expect(stops).toBe(1)
  } finally {
    await registry.close()
  }
})

for (const outcome of ["success", "failure"] as const) {
  test(`factory result mutation during ${outcome} cannot substitute the listener being managed`, async () => {
    let started = false
    let stops = 0
    let otherStops = 0
    const config = { id: "source", name: "source", type: "source" }
    const other = {
      async start() {},
      async stop() {
        otherStops++
      },
      isAlive: () => false,
      isConnected: () => false,
    }
    const original = {
      async start() {
        started = true
        created.listener = other
        created.channelId = "other"
        config.type = "changed"
        if (outcome === "failure") throw new Error("startup failed")
      },
      async stop() {
        stops++
        started = false
      },
      isAlive: () => started,
      isConnected: () => started,
    }
    const created = { config, channelId: "channel", listener: original }
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [
          {
            id: "source",
            name: "source",
            type: "source",
            channelId: "channel",
            channelName: "channel",
          },
        ],
        createListener: () => created,
      },
      notify: async () => {},
    })
    try {
      const result = await registry.start("channel", "source")
      expect(result.ok).toBe(outcome === "success")
      if (outcome === "success") {
        expect(registry.list()).toMatchObject([
          { channelId: "channel", type: "source", alive: true },
        ])
        await registry.stopAll()
      } else expect(result.reason).toBe("startup failed")
      expect(stops).toBe(1)
      expect(otherStops).toBe(0)
      expect(started).toBe(false)
    } finally {
      await registry.close()
    }
  })
}
