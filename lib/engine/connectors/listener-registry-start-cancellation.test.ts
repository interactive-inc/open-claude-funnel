import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"

for (const boundary of ["queued", "configuration", "factory"] as const) {
  test(`stop at the ${boundary} boundary prevents an unopened listener from starting`, async () => {
    let starts = 0
    let stops = 0
    let factories = 0
    let cancel = true
    let cancelOnRead = false
    let stopping: Promise<unknown> | undefined
    class Listener extends FunnelConnectorListener {
      async start() {
        starts++
      }
      async stop() {
        stops++
      }
    }
    const config = { id: "source", name: "source", type: "source" }
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => {
          if (cancel && boundary === "configuration" && cancelOnRead) {
            cancelOnRead = false
            stopping = registry.stop("channel", "source")
          }
          return [{ ...config, channelId: "channel", channelName: "channel" }]
        },
        createListener: () => {
          factories++
          if (cancel && boundary === "factory") stopping = registry.stop("channel", "source")
          return { config, channelId: "channel", listener: new Listener() }
        },
      },
      notify: async () => {},
    })
    try {
      const starting = registry.start("channel", "source")
      cancelOnRead = true
      if (boundary === "queued") stopping = registry.stop("channel", "source")
      expect(await starting).toMatchObject({ ok: false, reason: "start cancelled" })
      await stopping
      expect(starts).toBe(0)
      expect(factories).toBe(boundary === "factory" ? 1 : 0)
      expect(stops).toBe(boundary === "factory" ? 1 : 0)
      expect(registry.isRunning("channel", "source")).toBe(false)
      cancel = false
      expect(await registry.start("channel", "source")).toMatchObject({ ok: true })
      expect(starts).toBe(1)
    } finally {
      await registry.close()
    }
  })
}
