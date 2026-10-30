import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"

for (const path of ["direct", "gateway"] as const) {
  for (const kind of ["resolved", "rejected", "hidden-then", "thenable", "then-return"] as const) {
    test(`${path} offset restore rejects a ${kind} async result, reports failure and recovers`, async () => {
      const failure = new Error("sequence read unavailable")
      const reported: unknown[] = []
      const onError = (error: Error, context?: Record<string, unknown>) => {
        reported.push({ error, context })
      }
      const bad = (): unknown => {
        if (kind === "then-return")
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- A host then method can reject after resolving its callback.
            then(resolve: (value: unknown) => void) {
              resolve(7)
              const returned = Promise.reject(failure)
              void returned.catch(() => {})
              return returned
            },
          }
        if (kind === "thenable")
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied asynchronous offset.
            then(_resolve: unknown, reject: (error: unknown) => void) {
              reject(failure)
            },
          }
        const value = kind === "resolved" ? Promise.resolve(7) : Promise.reject(failure)
        // Keep the regression safe on the old implementation while checking host reporting.
        void value.catch(() => {})
        if (kind === "hidden-then") {
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden method.
          Object.defineProperty(value, "then", { value: undefined })
        }
        return value
      }
      if (path === "direct") {
        const broadcaster = new FunnelBroadcaster({ onError })
        expect(() => broadcaster.seedLatestOffset(bad() as never)).toThrow(
          "restored event offset must be synchronous",
        )
        expect(broadcaster.broadcast("first").offset).toBe(1)
        broadcaster.seedLatestOffset(7)
        expect(broadcaster.broadcast("after restore").offset).toBe(8)
      } else {
        let invalid = true
        let closed = 0
        class Store extends MemoryFunnelEventLog {
          override findMaxOffset(): number {
            return invalid ? (bad() as never) : super.findMaxOffset()
          }
          override close() {
            closed++
            super.close()
          }
        }
        const store = new Store()
        store.record({
          offset: 7,
          content: "retained",
          channelId: null,
          connectorId: null,
          meta: null,
        })
        const funnel = new Funnel({ channels: [{ name: "ops" }], onError })
        expect(() => funnel.gatewayModule({ token: "", eventLog: store })).toThrow(
          "restored event offset must be synchronous",
        )
        expect(closed).toBe(0)
        invalid = false
        const gateway = funnel.gatewayModule({ token: "", eventLog: store })
        try {
          expect(gateway.emit({ channel: "ops", content: "after restore" }).offset).toBe(8)
          expect(store.loadSince(0).map((event) => event.offset)).toEqual([7, 8])
        } finally {
          await gateway.stop()
          store.close()
        }
      }
      await Bun.sleep(0)
      expect(reported).toEqual(
        kind === "resolved"
          ? []
          : [{ error: failure, context: { component: "broadcaster.offset-restore" } }],
      )
    })
  }
}
