import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelGatewayClient } from "@/gateway/gateway-client"

test("HTTP client publishes to the native gateway and observes listener state", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayServer({
    port: 0,
    token: "test-token",
  })
  const events = gateway.events({ channel: "ops" })
  try {
    await gateway.start()
    const client = new FunnelGatewayClient({
      baseUrl: `http://127.0.0.1:${gateway.port}`,
      token: () => "test-token",
    })
    expect(await client.list()).toEqual({ state: "ok", listeners: [] })
    const result = await client.publish("ops", {
      content: "native HTTP input",
      meta: { thread_ts: "123" },
    })
    expect(result).toEqual({ state: "ok", offset: 1 })
    expect((await events.next()).value.content).toBe("native HTTP input")
    expect(await client.start("ops", "missing")).toMatchObject({ state: "error" })
  } finally {
    await events.return()
    await gateway.stop()
  }
})

test("HTTP client reads the host credential on each request and refuses redirects", async () => {
  const seen: string[] = []
  let token = "first"
  const client = new FunnelGatewayClient({
    baseUrl: "https://gateway.example",
    token: () => token,
    fetch: async (url, init) => {
      seen.push(
        String(url),
        new Headers(init?.headers).get("authorization") ?? "",
        init?.redirect ?? "",
      )
      return Response.json({ listeners: [] })
    },
  })
  await client.list()
  token = "second"
  await client.list()
  expect(seen).toEqual([
    "https://gateway.example/listeners",
    "Bearer first",
    "error",
    "https://gateway.example/listeners",
    "Bearer second",
    "error",
  ])
})

test("HTTP client never sends when unavailable or without a host token", async () => {
  let requests = 0
  const send: typeof fetch = Object.assign(
    async () => {
      requests++
      return Response.json({ listeners: [] })
    },
    { preconnect: fetch.preconnect },
  )
  const offline = new FunnelGatewayClient({
    baseUrl: "http://localhost:1234",
    token: () => null,
    isAvailable: () => false,
    fetch: send,
  })
  expect(await offline.list()).toEqual({ state: "offline" })
  expect(await offline.publish("ops", { content: "test" })).toEqual({ state: "offline" })
  const missing = new FunnelGatewayClient({
    baseUrl: "http://localhost:1234",
    token: () => null,
    fetch: send,
  })
  expect(await missing.list()).toMatchObject({ state: "error" })
  expect(requests).toBe(0)
})

test("listener operations encode names and preserve structured failures", async () => {
  const paths: string[] = []
  const client = new FunnelGatewayClient({
    baseUrl: "http://localhost:1234",
    token: () => "host-token",
    fetch: async (url) => {
      paths.push(String(url))
      return Response.json({ reason: "already starting" }, { status: 409 })
    },
  })
  expect(await client.start("a/b", "c d")).toEqual({ state: "error", reason: "already starting" })
  expect(paths).toEqual(["http://localhost:1234/listeners/a%2Fb/c%20d/start"])
})

test("host availability failures follow the client's error result contract", async () => {
  const client = new FunnelGatewayClient({
    baseUrl: "http://localhost:1234",
    token: () => null,
    isAvailable: () => {
      throw new Error("host probe failed")
    },
  })
  expect(await client.list()).toEqual({ state: "error", reason: "host probe failed" })
  expect(await client.start("ops", "slack")).toEqual({
    state: "error",
    reason: "host probe failed",
  })
  expect(await client.publish("ops", { content: "test" })).toEqual({
    state: "error",
    reason: "host probe failed",
  })
})
