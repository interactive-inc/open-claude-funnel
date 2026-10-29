import { expect, test } from "bun:test"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { FunnelDiscordAdapter } from "@/engine/connectors/discord-adapter"
import type { FunnelHttpClient } from "@/engine/http/http-client"
import { FunnelGatewayClient } from "@/gateway/gateway-client"

for (const type of ["gateway", "gh", "discord"] as const) {
  for (const unreadable of [false, true]) {
    test(`${type} preserves HTTP failure context when reading its error body fails (unreadable=${unreadable})`, async () => {
      const failure = unreadable ? Object.create(null) : new Error("stream reset")
      let broken = true
      const detail = unreadable ? "Unprintable thrown value" : "stream reset"
      const http: FunnelHttpClient = {
        async fetch() {
          return {
            status: broken ? 503 : 200,
            ok: !broken,
            async text() {
              throw failure
            },
            async json() {
              return { ok: true }
            },
          }
        },
      }
      const client = new FunnelGatewayClient({
        baseUrl: "https://gateway.example",
        token: () => "example-token",
        fetch: async () => {
          if (!broken) return Response.json({ ok: true, offset: 1 })
          const response = new Response("", { status: 503 })
          Object.defineProperty(response, "text", {
            value() {
              throw failure
            },
          })
          return response
        },
      })
      const adapter =
        type === "gh"
          ? new FunnelGhAdapter({
              config: { id: "source", name: "source", type, token: "example-token" },
              http,
            })
          : new FunnelDiscordAdapter({
              config: { id: "source", name: "source", type: "discord", botToken: "example-token" },
              http,
            })
      if (type === "gateway") {
        expect(await client.publish("channel", { content: "input" })).toEqual({
          state: "error",
          reason: `HTTP 503: response body read failed: ${detail}`,
        })
      } else {
        await expect(adapter.call({ method: "GET", path: "example" })).rejects.toThrow(
          `${type === "gh" ? "GitHub" : "Discord"} API failed (503): response body read failed: ${detail}`,
        )
      }
      broken = false
      if (type === "gateway")
        expect(await client.publish("channel", { content: "retry" })).toEqual({
          state: "ok",
          offset: 1,
        })
      else expect(await adapter.call({ method: "GET", path: "example" })).toEqual({ ok: true })
    })
  }
}

for (const type of ["gh", "discord"] as const) {
  test(`${type} preserves cancellation while its error body fails`, async () => {
    const controller = new AbortController()
    const reason = new Error("operation canceled")
    const http: FunnelHttpClient = {
      async fetch() {
        return {
          status: 503,
          ok: false,
          async text() {
            controller.abort(reason)
            throw new Error("body aborted")
          },
          async json() {
            return null
          },
        }
      },
    }
    const adapter =
      type === "gh"
        ? new FunnelGhAdapter({
            config: { id: "source", name: "source", type, token: "example-token" },
            http,
          })
        : new FunnelDiscordAdapter({
            config: { id: "source", name: "source", type, botToken: "example-token" },
            http,
          })
    await expect(
      adapter.call({ method: "GET", path: "example", signal: controller.signal }),
    ).rejects.toBe(reason)
  })
}
