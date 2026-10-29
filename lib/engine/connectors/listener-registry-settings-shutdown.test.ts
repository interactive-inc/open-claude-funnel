import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"

for (const shutdown of ["stopAll", "close"] as const) {
  for (const cleanupFails of [false, true]) {
    test(`${shutdown} cleans up every listener during a settings outage (cleanup fails=${cleanupFails})`, async () => {
      let broken = false
      const stopped: string[] = []
      const reports: string[] = []
      const configs = ["first", "second"].map((id) => ({ id, name: id, type: "source" }))
      class Listener extends FunnelConnectorListener {
        constructor(private readonly id: string) {
          super()
        }
        async start() {}
        async stop() {
          stopped.push(this.id)
          if (cleanupFails && this.id === "first") throw new Error("cleanup failed")
        }
      }
      const registry = new FunnelListenerRegistry({
        channels: {
          listAllConnectors() {
            if (broken) throw Object.create(null)
            return configs.map((config) => ({
              ...config,
              channelId: "channel",
              channelName: "channel",
            }))
          },
          createListener: (_channel, name) => {
            const config = configs.find((item) => item.name === name)!
            return { config, channelId: "channel", listener: new Listener(config.id) }
          },
        },
        notify: async () => {},
        onError: (_error, context) => {
          reports.push(String(context?.component))
        },
      })
      try {
        await registry.startAll()
        expect(registry.list()).toHaveLength(2)
        broken = true
        await registry[shutdown]()
        expect(stopped.sort()).toEqual(["first", "second"])
        expect(registry.list()).toEqual([])
        expect(
          reports.filter((value) => value === "listener-registry.stop-configuration"),
        ).toHaveLength(2)
        expect(reports.filter((value) => value === "listener-registry.stop")).toHaveLength(
          cleanupFails ? 1 : 0,
        )
      } finally {
        broken = false
        await registry.close()
      }
    })
  }
}
