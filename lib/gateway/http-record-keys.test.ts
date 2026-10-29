import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { ghConnector } from "@/engine/connectors/gh-connector"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
import { FunnelGatewayClient } from "@/gateway/gateway-client"
import { publishRequestSchema } from "@/gateway/publish-schema"
import type { z } from "zod"

const setup = () => {
  const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"accepted":true}' }))
  const gateway = new Funnel({
    http,
    connectors: [ghConnector()],
    channels: [
      { name: "ops", connectors: [{ name: "source", type: "gh", token: "example-token" }] },
    ],
  }).gatewayModule({ token: "" })
  return { http, gateway }
}

test("publication retains string-valued metadata input types", () => {
  const accepts = (input: z.input<typeof publishRequestSchema>) =>
    publishRequestSchema.safeParse(input).success
  expect(accepts({ content: "input", meta: { detail: "value" } })).toBe(true)
  // @ts-expect-error Metadata values must remain strings in the public input type.
  expect(accepts({ content: "input", meta: { detail: 42 } })).toBe(false)
})

test("HTTP connector calls preserve special JSON keys at every object level", async () => {
  const { http, gateway } = setup()
  const body = JSON.parse(
    '{"__proto__":{"kind":"literal"},"nested":[{"__proto__":false}],"constructor":"value"}',
  )
  try {
    const response = await gateway.app.request("/channels/ops/connectors/source/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "POST", path: "example", body }),
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(http.calls[0]!.body!)).toEqual(body)
    expect(Object.hasOwn(JSON.parse(http.calls[0]!.body!), "__proto__")).toBe(true)
    expect(Object.hasOwn(Object.prototype, "kind")).toBe(false)
  } finally {
    await gateway.stop()
  }
})

test("HTTP client publication preserves special metadata keys in replay", async () => {
  const { gateway } = setup()
  try {
    const client = new FunnelGatewayClient({
      baseUrl: "https://gateway.example",
      token: () => "example-token",
      fetch: async (url, init) => gateway.app.request(String(url), init),
    })
    expect(
      await client.publish("ops", {
        content: "input",
        meta: JSON.parse('{"__proto__":"literal","constructor":"value"}'),
      }),
    ).toEqual({ state: "ok", offset: 1 })
    const meta = gateway.getEventLog().loadSince(0)[0]!.meta!
    expect(Object.hasOwn(meta, "__proto__")).toBe(true)
    expect(meta.__proto__).toBe("literal")
    expect(Reflect.get(meta, "constructor")).toBe("value")
  } finally {
    await gateway.stop()
  }
})

test("publication does not coerce non-record metadata into empty dictionaries", () => {
  for (const meta of [[], new Map(), new Date(0)])
    expect(publishRequestSchema.safeParse({ content: "input", meta }).success).toBe(false)
})

test("object-valued calls retain the supported nesting limit", async () => {
  const { http, gateway } = setup()
  try {
    for (const depth of [127, 128]) {
      const nested = '{"key":'.repeat(depth) + "0" + "}".repeat(depth)
      const response = await gateway.app.request("/channels/ops/connectors/source/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"method":"POST","path":"example","body":' + nested + "}",
      })
      expect(response.status).toBe(depth === 127 ? 200 : 400)
      if (depth === 127) expect(http.calls[0]?.body).toBe(nested)
    }
    expect(http.calls).toHaveLength(1)
  } finally {
    await gateway.stop()
  }
})

test("invalid numbers under special JSON keys cannot bypass outbound validation", async () => {
  const { http, gateway } = setup()
  try {
    const response = await gateway.app.request("/channels/ops/connectors/source/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"method":"POST","path":"example","body":{"nested":[{"__proto__":1e999}]}}',
    })
    expect(response.status).toBe(400)
    expect(http.calls).toEqual([])
  } finally {
    await gateway.stop()
  }
})

test("invalid special metadata values cannot bypass publication validation", async () => {
  const { gateway } = setup()
  try {
    const response = await gateway.app.request("/channels/ops/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"content":"input","meta":{"__proto__":42}}',
    })
    expect(response.status).toBe(400)
    expect(gateway.getEventLog().loadSince(0)).toEqual([])
  } finally {
    await gateway.stop()
  }
})
