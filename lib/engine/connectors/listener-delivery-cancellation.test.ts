import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"

for (const action of ["stop", "stopAll", "close"] as const) {
  for (const phase of ["read", "name"] as const) {
    test(`${action} during delivery configuration ${phase} prevents a new host notification`, async () => {
      let armed = false
      let stopping: Promise<unknown> | undefined
      let emit: NotifyFn = async () => {
        throw new Error("not started")
      }
      const delivered: string[] = []
      let stopped = 0
      const config = { id: "source", name: "source", type: "test" }
      const shutdown = () => {
        if (!armed) return
        armed = false
        stopping = action === "stop" ? registry.stop("channel", "source") : registry[action]()
      }
      class Listener extends FunnelConnectorListener {
        async start(notify: NotifyFn) {
          emit = notify
        }
        async stop() {
          stopped++
        }
      }
      const registry = new FunnelListenerRegistry({
        channels: {
          listAllConnectors() {
            if (phase === "read") shutdown()
            return [
              {
                ...config,
                channelId: "channel",
                get channelName() {
                  if (phase === "name") shutdown()
                  return "channel"
                },
              },
            ]
          },
          createListener: () => ({ config, channelId: "channel", listener: new Listener() }),
        },
        notify: async (_channel, _connector, content) => {
          delivered.push(content)
        },
      })
      try {
        expect((await registry.start("channel", "source")).ok).toBe(true)
        const oldEmit = emit
        armed = true
        await expect(oldEmit("blocked")).rejects.toThrow("listener stopped before delivery")
        await stopping
        expect(delivered).toEqual([])
        expect(stopped).toBe(1)
        if (action !== "close") {
          expect((await registry.start("channel", "source")).ok).toBe(true)
          await emit("replacement")
          await expect(oldEmit("stale")).rejects.toThrow("listener stopped before delivery")
          expect(delivered).toEqual(["replacement"])
        }
      } finally {
        armed = false
        await registry.close()
      }
    })
  }
}
