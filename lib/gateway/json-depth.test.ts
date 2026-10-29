import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { ghConnector } from "@/engine/connectors/gh-connector"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"

const nested = (depth: number) => "[".repeat(depth) + "0" + "]".repeat(depth)

test("excessively nested HTTP JSON is rejected before parsing, forwarding or publishing", async () => {
  const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"accepted":true}' }))
  const gateway = new Funnel({
    http,
    connectors: [ghConnector()],
    channels: [
      { name: "ops", connectors: [{ type: "gh", name: "source", token: "example-token" }] },
    ],
  }).gatewayModule({ token: "" })
  try {
    for (const depth of [128, 20_000]) {
      for (const [path, body] of [
        [
          "/channels/ops/connectors/source/call",
          '{"method":"POST","path":"example","body":' + nested(depth) + "}",
        ],
        ["/channels/ops/publish", '{"content":"input","extra":' + nested(depth) + "}"],
      ]) {
        const response = await gateway.app.request(path!, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
          ok: false,
          reason: "JSON nesting exceeds 128 levels",
        })
      }
    }
    for (const path of ["/channels/ops/connectors/source/call", "/channels/ops/publish"]) {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new Error("body unavailable"))
        },
      })
      const response = await gateway.app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, reason: "invalid body" })
    }
    expect(http.calls).toHaveLength(0)
    expect(gateway.getBroadcaster().getMetrics().eventsBroadcast).toBe(0)
    const response = await gateway.app.request("/channels/ops/connectors/source/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"method":"POST","path":"example","body":' + nested(127) + "}",
    })
    expect(response.status).toBe(200)
    expect(http.calls).toHaveLength(1)
    const published = await gateway.app.request("/channels/ops/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: '[\\"{'.repeat(20_000) }),
    })
    expect(published.status).toBe(200)
  } finally {
    await gateway.stop()
  }
})
