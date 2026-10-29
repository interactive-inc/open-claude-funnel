import { expect, test } from "bun:test"
import { FunnelGatewayClient } from "@/gateway/gateway-client"

for (const stage of ["availability", "token", "fetch", "body"] as const) {
  test(`unprintable ${stage} failures follow every HTTP client result contract`, async () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const unreadable = new Error()
    Object.defineProperty(unreadable, "message", {
      get() {
        throw new Error("unreadable message")
      },
    })
    for (const failure of [Object.create(null), revoked.proxy, unreadable]) {
      const fail = () => {
        throw failure
      }
      const client = new FunnelGatewayClient({
        baseUrl: "https://gateway.example",
        token: stage === "token" ? fail : () => "example-token",
        isAvailable: stage === "availability" ? fail : () => true,
        fetch:
          stage === "fetch"
            ? async () => fail()
            : async () => {
                const response = Response.json({ listeners: [], ok: true, offset: 1 })
                if (stage === "body")
                  Object.defineProperty(response, "json", { value: async () => fail() })
                return response
              },
      })
      const expected = { state: "error", reason: "Unprintable thrown value" } as const
      expect(await client.list()).toEqual(expected)
      expect(await client.start("channel", "connector")).toEqual(expected)
      expect(await client.stop("channel", "connector")).toEqual(expected)
      expect(await client.restart("channel", "connector")).toEqual(expected)
      expect(await client.publish("channel", { content: "input" })).toEqual(expected)
    }
  })
}
