import { expect, test } from "bun:test"
import { FunnelSlackAdapter } from "@/engine/connectors/slack-adapter"
import { FunnelDiscordAdapter } from "@/engine/connectors/discord-adapter"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
import type { FunnelHttpClient } from "@/engine/http/http-client"

const adapters = [
  {
    name: "Slack",
    create: (http: FunnelHttpClient) =>
      new FunnelSlackAdapter({
        http,
        config: {
          id: "source",
          name: "source",
          type: "slack",
          botToken: "xoxb-example",
          minify: true,
        },
      }),
  },
  {
    name: "Discord",
    create: (http: FunnelHttpClient) =>
      new FunnelDiscordAdapter({
        http,
        config: { id: "source", name: "source", type: "discord", botToken: "example-token" },
      }),
  },
  {
    name: "GitHub",
    create: (http: FunnelHttpClient) =>
      new FunnelGhAdapter({
        http,
        config: { id: "source", name: "source", type: "gh", token: "example-token" },
      }),
  },
]

for (const { name, create } of adapters) {
  test(`${name} forwards call cancellation to the HTTP boundary`, async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
    const controller = new AbortController()
    await create(http).call({ method: "POST", path: "send", signal: controller.signal })
    expect(http.calls[0]?.signal).toBe(controller.signal)
  })

  test(`${name} does not send a pre-aborted call`, async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
    const controller = new AbortController()
    controller.abort()
    await expect(
      create(http).call({ method: "POST", path: "send", signal: controller.signal }),
    ).rejects.toThrow()
    expect(http.calls).toHaveLength(0)
  })

  for (const phase of name === "Slack" ? ["path", "body"] : ["method", "path", "body"]) {
    test(`${name} stops reading input after the ${phase} getter cancels`, async () => {
      const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
      const controller = new AbortController()
      const reason = new Error("call cancelled")
      const reads: string[] = []
      const read = (key: string) => {
        if (controller.signal.aborted) throw new Error("input accessed after cancellation")
        reads.push(key)
        if (key === phase) controller.abort(reason)
      }
      await expect(
        create(http).call({
          signal: controller.signal,
          get method() {
            read("method")
            return "POST"
          },
          get path() {
            read("path")
            return "messages"
          },
          get body() {
            read("body")
            return {
              get content(): string {
                throw new Error("body serialized after cancellation")
              },
            }
          },
        }),
      ).rejects.toBe(reason)
      const keys = name === "Slack" ? ["path", "body"] : ["method", "path", "body"]
      expect(reads).toEqual(keys.slice(0, keys.indexOf(phase) + 1))
      expect(http.calls).toHaveLength(0)
    })
  }

  test(`${name} checks cancellation after serializing the body`, async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
    const controller = new AbortController()
    const body = {
      get text() {
        controller.abort()
        return "example"
      },
    }
    await expect(
      create(http).call({ method: "POST", path: "send", body, signal: controller.signal }),
    ).rejects.toThrow()
    expect(http.calls).toHaveLength(0)
  })

  test(`${name} ignores a late response from a transport that missed cancellation`, async () => {
    const controller = new AbortController()
    const http = new MemoryFunnelHttpClient().on(() => {
      controller.abort()
      return { body: '{"ok":true}' }
    })
    await expect(
      create(http).call({ method: "POST", path: "send", signal: controller.signal }),
    ).rejects.toThrow()
    expect(http.calls).toHaveLength(1)
  })

  test(`${name} checks cancellation after consuming the response body`, async () => {
    const controller = new AbortController()
    const http: FunnelHttpClient = {
      fetch: async () => ({
        status: 200,
        ok: true,
        text: async () => {
          controller.abort()
          return '{"ok":true}'
        },
        json: async () => {
          controller.abort()
          return { ok: true }
        },
      }),
    }
    await expect(
      create(http).call({ method: "POST", path: "send", signal: controller.signal }),
    ).rejects.toThrow()
  })
}
