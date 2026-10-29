import { expect, test } from "bun:test"
import { FunnelDiscordAdapter } from "@/engine/connectors/discord-adapter"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import type { JsonValue } from "@/engine/connectors/connector-adapter"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
import { discordConnector } from "@/engine/connectors/discord-connector"
import { Funnel } from "@/funnel"

const discordConfig = { id: "discord", name: "chat", type: "discord", botToken: "example-token" }
const bodies: JsonValue[] = [[], {}, null, false, 0, "", ["example"]]

test.each(bodies.map((body) => ({ body })))(
  "Discord preserves the supplied JSON body: $body",
  async (input) => {
    const http = new MemoryFunnelHttpClient().on(() => ({ status: 204 }))
    const adapter = new FunnelDiscordAdapter({
      config: { ...discordConfig, type: "discord" },
      http,
    })
    await adapter.call({ method: "PUT", path: "/applications/example/commands", body: input.body })
    expect(http.calls[0]?.body).toBe(JSON.stringify(input.body))
  },
)

test("Discord omits absent bodies without changing them to JSON null", async () => {
  const http = new MemoryFunnelHttpClient().on(() => ({ status: 204 }))
  const adapter = new FunnelDiscordAdapter({ config: { ...discordConfig, type: "discord" }, http })
  await adapter.call({ method: "DELETE", path: "/channels/example" })
  expect(http.calls[0]?.body).toBeUndefined()
})

test("Discord HEAD sends no body and accepts a successful empty response", async () => {
  const http = new MemoryFunnelHttpClient().on(() => ({ status: 200 }))
  const adapter = new FunnelDiscordAdapter({ config: { ...discordConfig, type: "discord" }, http })
  expect(
    await adapter.call({ method: "HEAD", path: "/users/@me", body: { ignored: true } }),
  ).toBeNull()
  expect(http.calls[0]?.body).toBeUndefined()
})

test("GitHub HEAD accepts a successful empty response", async () => {
  const http = new MemoryFunnelHttpClient().on(() => ({ status: 200 }))
  const adapter = new FunnelGhAdapter({
    config: { id: "gh", name: "code", type: "gh", token: "example-token" },
    http,
  })
  expect(await adapter.call({ method: "HEAD", path: "user", body: { ignored: true } })).toBeNull()
  expect(http.calls[0]?.body).toBeUndefined()
})

for (const type of ["gh", "discord"] as const) {
  test(`${type} accepts a bodyless 205 success response`, async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ status: 205 }))
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
    for (const method of ["GET", "POST", "DELETE"])
      expect(await adapter.call({ method, path: "example" })).toBeNull()
    expect(http.calls).toHaveLength(3)
  })
}

for (const status of [204, 205]) {
  test(`authenticated gateway calls preserve empty arrays with a ${status} response`, async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ status }))
    const funnel = new Funnel({
      http,
      connectors: [discordConnector()],
      channels: [{ name: "ops", connectors: [{ ...discordConfig, type: "discord" }] }],
    })
    const gateway = funnel.gatewayModule({ token: "example-gateway-token" })
    try {
      const response = await gateway.app.request("/channels/ops/connectors/chat/call", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer example-gateway-token",
        },
        body: JSON.stringify({ method: "PUT", path: "/applications/example/commands", body: [] }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, result: null })
      expect(http.calls[0]?.body).toBe("[]")
    } finally {
      await gateway.stop()
    }
  })
}
