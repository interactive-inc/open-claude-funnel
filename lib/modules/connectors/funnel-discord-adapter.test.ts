import { describe, expect, test } from "bun:test"
import { FunnelDiscordAdapter } from "@/modules/connectors/funnel-discord-adapter"
import { MemoryFunnelHttpClient } from "@/modules/http/memory-funnel-http-client"

const config = {
  type: "discord" as const,
  name: "test",
  botToken: "a".repeat(50),
}

describe("FunnelDiscordAdapter", () => {
  test("GET sends no body and includes Authorization header", async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({
      status: 200,
      body: '{"id":"1"}',
    }))
    const adapter = new FunnelDiscordAdapter({ config, http })

    const result = await adapter.call({ method: "get", path: "/users/@me" })

    expect(result).toEqual({ id: "1" })

    const req = http.calls[0]
    expect(req?.method).toBe("GET")
    expect(req?.url).toBe("https://discord.com/api/v10/users/@me")
    expect(req?.headers?.Authorization).toBe(`Bot ${config.botToken}`)
    expect(req?.body).toBeUndefined()
  })

  test("POST serializes body as JSON", async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ status: 200, body: '{"ok":true}' }))
    const adapter = new FunnelDiscordAdapter({ config, http })

    await adapter.call({
      method: "post",
      path: "/channels/1/messages",
      body: { content: "hi" },
    })

    expect(http.calls[0]?.body).toBe('{"content":"hi"}')
  })

  test("status 204 returns null", async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ status: 204 }))
    const adapter = new FunnelDiscordAdapter({ config, http })

    expect(await adapter.call({ method: "delete", path: "/channels/1" })).toBeNull()
  })

  test("error responses throw Error", async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ status: 401, body: "unauthorized" }))
    const adapter = new FunnelDiscordAdapter({ config, http })

    expect(adapter.call({ method: "get", path: "/" })).rejects.toThrow(/Discord API failed \(401\)/)
  })
})
