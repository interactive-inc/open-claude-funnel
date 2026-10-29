import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

for (const method of ["queryProcessed", "queryConnection"] as const) {
  for (const kind of ["resolved", "promise", "hidden-then", "thenable"] as const) {
    test(`debug rejects an asynchronous ${method} ${kind} without faking diagnostic history`, async () => {
      const failure = new Error("diagnostic storage unavailable")
      const reported: unknown[] = []
      let invalid = true
      const bad = () => {
        if (kind === "thenable")
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied asynchronous query.
            then(_resolve: unknown, reject: (error: unknown) => void) {
              reject(failure)
            },
          }
        const promise = kind === "resolved" ? Promise.resolve([]) : Promise.reject(failure)
        void promise.catch(() => {})
        if (kind === "hidden-then") {
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden then method.
          Object.defineProperty(promise, "then", { value: undefined })
        }
        return promise
      }
      class Diagnostics extends MemoryConnectorDiagnosticLog {
        override queryProcessed() {
          return invalid && method === "queryProcessed" ? (bad() as never) : []
        }
        override queryConnection() {
          return invalid && method === "queryConnection" ? (bad() as never) : []
        }
      }
      const funnel = new Funnel({
        channels: [{ name: "channel" }],
        diagnosticLog: new Diagnostics(),
        onError: (error, context) => {
          reported.push({ error, context })
        },
      })
      const channelId = funnel.channels.get("channel")!.id
      const gateway = funnel.gatewayModule({ token: "" })
      try {
        const response = await gateway.app.request("/debug")
        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({ error: `diagnostic ${method} must be synchronous` })
        await Bun.sleep(0)
        expect(reported).toEqual(
          kind === "resolved"
            ? []
            : [
                {
                  error: failure,
                  context: {
                    component: "gateway.diagnostic-query",
                    query: method,
                    channelId,
                  },
                },
              ],
        )
        invalid = false
        const restored = await gateway.app.request("/debug")
        expect(restored.status).toBe(200)
        const body = (await restored.json()) as { channels: unknown[] }
        expect(body.channels[0]).toMatchObject({
          recentEvents: [],
          connections: [],
        })
      } finally {
        await gateway.stop()
      }
    })
  }
}
