import { expect, test } from "bun:test"
import { setTimeout as delay } from "node:timers/promises"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"

for (const phase of ["recover", "retry"] as const) {
  for (const port of ["node", "reason", "unexpected-error"] as const) {
    for (const action of ["stop", "stop-all", "start"] as const) {
      test(`${action} cancels ${phase} backoff through ${port} with cancellation and genuine failures distinguished`, async () => {
        class Source extends FunnelConnectorListener {
          starts = 0
          alive = false
          async start() {
            this.starts++
            if (phase === "retry" && this.starts === 1) throw new Error("initial failure")
            this.alive = true
          }
          async stop() {
            this.alive = false
          }
          override isAlive() {
            return this.alive
          }
        }
        const source = new Source()
        const config = { id: "source-id", name: "source", type: "example" }
        const entered = Promise.withResolvers<void>()
        const errors: string[] = []
        const logger = new MemoryFunnelLogger()
        const registry = new FunnelListenerRegistry({
          channels: {
            listAllConnectors: () => [{ ...config, channelId: "ops-id", channelName: "ops" }],
            createListener: () => ({ config, channelId: "ops-id", listener: source }),
          },
          notify: async () => {},
          logger,
          sleep: (ms, signal) => {
            if (ms === 1000) {
              entered.resolve()
              if (port !== "node")
                return new Promise<void>((_resolve, reject) => {
                  const fail = () =>
                    reject(port === "reason" ? signal?.reason : new Error("backoff wait failed"))
                  if (signal?.aborted) fail()
                  else signal?.addEventListener("abort", fail, { once: true })
                })
            }
            return delay(ms, undefined, { signal, ref: false })
          },
          onError: (error) => {
            errors.push(error.message)
          },
        })
        let health: Promise<void> | undefined
        try {
          await registry.startAll()
          errors.length = 0
          logger.clear()
          source.alive = false
          health = registry.runHealthCheckForTest()
          await entered.promise
          if (action === "stop") await registry.stop("ops", "source")
          else if (action === "stop-all") await registry.stopAll()
          else expect((await registry.start("ops", "source")).ok).toBe(true)
          await health
          expect(errors).toEqual(port === "unexpected-error" ? ["backoff wait failed"] : [])
          expect(
            logger.entries.filter((entry) => entry.message === "listener health task failed"),
          ).toHaveLength(port === "unexpected-error" ? 1 : 0)
          expect(source.starts).toBe(action === "start" ? 2 : 1)
          await registry.runHealthCheckForTest()
          expect(source.starts).toBe(action === "start" ? 2 : 1)
        } finally {
          await registry.close()
          await health
        }
      })
    }
  }
}
