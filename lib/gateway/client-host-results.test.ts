import { expect, test } from "bun:test"
import { FunnelGatewayClient } from "@/gateway/gateway-client"

for (const hook of ["token", "isAvailable"] as const) {
  for (const kind of [
    "resolved",
    "rejected",
    "hidden-then",
    "thenable",
    "object",
    "number",
    "undefined",
    ...(hook === "isAvailable" ? ["null", "string"] : []),
  ] as const) {
    test(`client rejects ${hook} ${kind} results before sending any operation`, async () => {
      let invalid = true
      let requests = 0
      let credentials = 0
      const bad = (): unknown => {
        if (kind === "object") return {}
        if (kind === "number") return 1
        if (kind === "null") return null
        if (kind === "string") return "false"
        if (kind === "undefined") return undefined
        if (kind === "thenable")
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied asynchronous callback.
            then(_resolve: unknown, reject: (error: unknown) => void) {
              reject(new Error("host unavailable"))
            },
          }
        const value =
          kind === "resolved"
            ? Promise.resolve(hook === "token" ? "example-token" : false)
            : Promise.reject(new Error("host unavailable"))
        // Keep the old implementation safe while asserting that dispatch is refused.
        void value.catch(() => {})
        if (kind === "hidden-then") {
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden method.
          Object.defineProperty(value, "then", { value: undefined })
        }
        return value
      }
      const client = new FunnelGatewayClient({
        baseUrl: "https://gateway.example",
        token() {
          credentials++
          return invalid && hook === "token" ? (bad() as never) : "example-token"
        },
        isAvailable() {
          return invalid && hook === "isAvailable" ? (bad() as never) : true
        },
        async fetch() {
          requests++
          return Response.json({ listeners: [], ok: true, offset: 1 })
        },
      })
      const operations = [
        () => client.list(),
        () => client.start("ops", "source"),
        () => client.stop("ops", "source"),
        () => client.restart("ops", "source"),
        () => client.publish("ops", { content: "input" }),
      ]
      const label = hook === "token" ? "gateway token" : "gateway availability"
      const asynchronous = ["resolved", "rejected", "hidden-then", "thenable"].includes(kind)
      for (const operation of operations) {
        expect(await operation()).toEqual({
          state: "error",
          reason: asynchronous
            ? `${label} must be synchronous`
            : `${label} must be ${hook === "token" ? "a string or null" : "a boolean"}`,
        })
        expect(requests).toBe(0)
      }
      if (hook === "isAvailable") expect(credentials).toBe(0)
      await Bun.sleep(0)
      invalid = false
      for (const operation of operations) expect(await operation()).toMatchObject({ state: "ok" })
      expect(requests).toBe(5)
    })
  }
}
