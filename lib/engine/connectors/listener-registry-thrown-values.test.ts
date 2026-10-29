import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"

const failures = () => {
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  const unreadable = new Error()
  Object.defineProperty(unreadable, "message", {
    get() {
      throw new Error("unreadable")
    },
  })
  return [Object.create(null), revoked.proxy, unreadable]
}

for (const [index, failure] of failures().entries()) {
  for (const stage of ["start", "stop", "health"] as const) {
    test(`unprintable ${stage} failures preserve cleanup and reporting (${index})`, async () => {
      let stops = 0
      class Listener extends FunnelConnectorListener {
        async start() {
          if (stage === "start") throw failure
        }
        async stop() {
          stops++
          if (stage === "stop") throw failure
        }
        override isAlive() {
          if (stage === "health") throw failure
          return true
        }
      }
      const config = { id: "connector", name: "connector", type: "source" }
      const reports: string[] = []
      const logger = new MemoryFunnelLogger()
      const registry = new FunnelListenerRegistry({
        channels: {
          listAllConnectors: () => [{ ...config, channelId: "channel", channelName: "channel" }],
          createListener: () => ({ config, channelId: "channel", listener: new Listener() }),
        },
        notify: async () => {},
        logger,
        onError: (_error, context) => {
          reports.push(String(context?.component))
        },
      })
      try {
        const start = await registry.start("channel", "connector")
        if (stage === "start") {
          expect(start).toMatchObject({ ok: false, reason: "Unprintable thrown value" })
          expect(stops).toBe(1)
          expect(registry.isRunning("channel", "connector")).toBe(false)
        } else {
          expect(start.ok).toBe(true)
          if (stage === "stop") {
            expect(await registry.stop("channel", "connector")).toMatchObject({
              ok: false,
              reason: "Unprintable thrown value",
            })
            expect(stops).toBe(1)
            expect(registry.isRunning("channel", "connector")).toBe(false)
          } else {
            await registry.runHealthCheckForTest()
            expect(stops).toBe(0)
            expect(registry.isRunning("channel", "connector")).toBe(true)
          }
        }
        expect(reports).toEqual([
          `listener-registry.${stage === "health" ? "health-state" : stage}`,
        ])
        expect(
          logger.entries.some((entry) => entry.meta?.error === "Unprintable thrown value"),
        ).toBe(true)
      } finally {
        await registry.close()
      }
    })
  }
}
