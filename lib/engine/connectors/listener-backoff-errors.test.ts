import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"

for (const canceled of [false, true]) {
  for (const kind of ["revoked", "unreadable-name", "abort"] as const) {
    test(`backoff preserves its original ${kind} failure (canceled=${canceled})`, async () => {
      const revoked = Proxy.revocable({}, {})
      revoked.revoke()
      const unreadable = new Error("sleep failed")
      Object.defineProperty(unreadable, "name", {
        get() {
          throw new Error("name unavailable")
        },
      })
      const abort = new DOMException("sleep aborted", "AbortError")
      const failure = kind === "revoked" ? revoked.proxy : kind === "abort" ? abort : unreadable
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const reports: Error[] = []
      class Listener extends FunnelConnectorListener {
        alive = true
        async start() {}
        async stop() {
          this.alive = false
        }
        override isAlive() {
          return this.alive
        }
      }
      const listener = new Listener()
      const config = { id: "source", name: "source", type: "source" }
      const registry = new FunnelListenerRegistry({
        channels: {
          listAllConnectors: () => [{ ...config, channelId: "ops", channelName: "ops" }],
          createListener: () => ({ config, channelId: "ops", listener }),
        },
        notify: async () => {},
        sleep: (ms) => {
          if (ms === 30_000) return new Promise(() => {})
          entered.resolve()
          return release.promise
        },
        onError: (error, context) => {
          if (context?.component === "listener-registry.health-task") reports.push(error)
        },
      })
      try {
        await registry.start("ops", "source")
        listener.alive = false
        const health = registry.runHealthCheckForTest()
        await entered.promise
        if (canceled) await registry.stopAll()
        release.reject(failure)
        await health
        if (canceled && kind === "abort") expect(reports).toEqual([])
        else {
          expect(reports).toHaveLength(1)
          if (kind === "revoked") expect(reports[0]?.message).toBe("Unprintable thrown value")
          else expect(reports[0]).toBe(kind === "abort" ? abort : unreadable)
        }
      } finally {
        release.resolve()
        await registry.close()
      }
    })
  }
}
