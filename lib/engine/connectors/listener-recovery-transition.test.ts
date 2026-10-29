import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"

for (const boundary of ["cleanup", "failure-log", "failure-notification"] as const) {
  test(`stop at the recovery ${boundary} boundary retains the original identity`, async () => {
    let configured = true
    let starts = 0
    let cancelOnStop = true
    let waits = 0
    const canceled = Promise.withResolvers<void>()
    const requestStop = (defer = false) => {
      if (!cancelOnStop) return
      cancelOnStop = false
      const cancel = () => {
        configured = false
        void registry.stop("ops", "source").then(() => {
          configured = true
          canceled.resolve()
        }, canceled.reject)
      }
      if (defer) queueMicrotask(cancel)
      else cancel()
    }
    class Listener extends FunnelConnectorListener {
      alive = true
      async start() {
        starts++
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
    class Logger extends MemoryFunnelLogger {
      override info(message: string) {
        if (boundary === "cleanup" && message === "test listener stopped") requestStop(true)
      }
      override warn(message: string) {
        if (boundary === "failure-log" && message === "listener health task failed") requestStop()
      }
    }
    const config = { id: "source", name: "source", type: "test" }
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () =>
          configured ? [{ ...config, channelId: "ops", channelName: "ops" }] : [],
        createListener: () => ({ config, channelId: "ops", listener }),
      },
      notify: async () => {},
      logger: new Logger(),
      sleep: (ms) => {
        if (ms === 30_000) return new Promise(() => {})
        if (boundary !== "cleanup" && ++waits === 1)
          return Promise.reject(new Error("backoff unavailable"))
        return Promise.resolve()
      },
      onError: (_error, context) => {
        if (
          boundary === "failure-notification" &&
          context?.component === "listener-registry.health-task"
        )
          requestStop()
      },
    })
    let health: Promise<void> | undefined
    const timer = setTimeout(() => canceled.reject(new Error("stop did not settle")), 1000)
    try {
      await registry.start("ops", "source")
      listener.alive = false
      health = registry.runHealthCheckForTest()
      await canceled.promise
      await health
      await registry.runHealthCheckForTest()
      expect(starts).toBe(1)
      expect(registry.isRunning("ops", "source")).toBe(false)
    } finally {
      clearTimeout(timer)
      await registry.close()
      await health
    }
  })
}
