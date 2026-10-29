import { expect, test } from "bun:test"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { FunnelDiscordAdapter } from "@/engine/connectors/discord-adapter"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"

for (const type of ["gh", "discord"] as const) {
  const setup = () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
    const adapter =
      type === "gh"
        ? new FunnelGhAdapter({
            config: { id: "source", name: "source", type: "gh", token: "example-token" },
            http,
          })
        : new FunnelDiscordAdapter({
            config: { id: "source", name: "source", type: "discord", botToken: "example-token" },
            http,
          })
    return { http, adapter }
  }

  test(`${type} sends the same body it inspected for presence`, async () => {
    const { http, adapter } = setup()
    let reads = 0
    await adapter.call({
      method: "POST",
      path: "messages",
      get body() {
        return ++reads === 1 ? { content: "original" } : undefined
      },
    })
    expect(http.calls[0]!.body).toBe(JSON.stringify({ content: "original" }))
    expect(reads).toBe(1)
  })

  for (const method of ["GET", "HEAD"] as const) {
    test(`${type} ${method} does not evaluate an unused request body`, async () => {
      const { http, adapter } = setup()
      await expect(
        adapter.call({
          method,
          path: "messages",
          get body(): undefined {
            throw new Error("unused body was read")
          },
        }),
      ).resolves.not.toBeUndefined()
      expect(http.calls).toHaveLength(1)
      expect(http.calls[0]!.body).toBeUndefined()
    })
  }

  for (const leadingSlash of [false, true]) {
    test(`${type} captures its ${leadingSlash ? "absolute" : "relative"} API path once`, async () => {
      const { http, adapter } = setup()
      let reads = 0
      await adapter.call({
        method: "GET",
        get path() {
          return ++reads === 1 ? `${leadingSlash ? "/" : ""}messages` : "/other"
        },
      })
      expect(http.calls[0]!.url).toBe(
        type === "gh" ? "https://api.github.com/messages" : "https://discord.com/api/v10/messages",
      )
      expect(reads).toBe(1)
    })
  }
}
