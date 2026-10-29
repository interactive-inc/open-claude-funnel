import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"

for (const phase of ["recovery", "retry", "queued-retry"] as const) {
  test(`stop retains its intent for a detached ${phase} after configuration is restored`, async () => {
    let configured = true
    let starts = 0
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<void>()
    class Listener extends FunnelConnectorListener {
      alive = true
      async start() {
        starts++
        if (phase !== "recovery" && starts === 1) throw new Error("temporary startup failure")
        this.alive = true
      }
      async stop() {
        this.alive = false
      }
      override isAlive() {
        return this.alive
      }
    }
    const listener = new Listener()
    const config = { id: "source", name: "source", type: "test" }
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () =>
          configured ? [{ ...config, channelId: "ops", channelName: "ops" }] : [],
        createListener: () => ({ config, channelId: "ops", listener }),
      },
      notify: async () => {},
      sleep: (ms, signal) => {
        if (ms === 30_000) return new Promise(() => {})
        if (phase === "queued-retry") return Promise.resolve()
        entered.resolve(signal!)
        return release.promise
      },
    })
    let health: Promise<void> | undefined
    try {
      expect((await registry.start("ops", "source")).ok).toBe(phase === "recovery")
      let signal: AbortSignal | undefined
      if (phase !== "queued-retry") {
        listener.alive = false
        health = registry.runHealthCheckForTest()
        signal = await entered.promise
      }
      configured = false
      await registry.stop("ops", "source")
      const canceled = signal?.aborted
      configured = true
      release.resolve()
      await health
      await registry.runHealthCheckForTest()
      expect(starts).toBe(1)
      if (signal) expect(canceled).toBe(true)
      expect(registry.isRunning("ops", "source")).toBe(false)
    } finally {
      release.resolve()
      await registry.close()
      await health
    }
  })
}
