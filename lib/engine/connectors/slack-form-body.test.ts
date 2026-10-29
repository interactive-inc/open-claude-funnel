import { expect, test } from "bun:test"
import { FunnelSlackAdapter } from "@/engine/connectors/slack-adapter"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"

const setup = () => {
  const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
  const adapter = new FunnelSlackAdapter({
    config: {
      type: "slack",
      id: "source",
      name: "source",
      botToken: "example-token",
      appToken: "example-app-token",
      minify: true,
    },
    http,
  })
  return { http, adapter }
}

test("Slack form serialization uses the same body that passed its object check", async () => {
  const { http, adapter } = setup()
  let reads = 0
  await expect(
    adapter.call({
      method: "post",
      path: "chat.postMessage",
      get body() {
        return ++reads === 1 ? { text: "original" } : null
      },
    }),
  ).resolves.toEqual({ ok: true })
  expect(reads).toBe(1)
  expect(new URLSearchParams(http.calls[0]!.body).get("text")).toBe("original")
})

test("Slack form serialization preserves every own JSON field including prototype names", async () => {
  const { http, adapter } = setup()
  const body = JSON.parse('{"__proto__":{"value":"input"},"constructor":"field","text":"hello"}')
  await adapter.call({ method: "post", path: "chat.postMessage", body })
  const form = new URLSearchParams(http.calls[0]!.body)
  expect([...form.keys()]).toEqual(["__proto__", "constructor", "text"])
  expect(form.get("__proto__")).toBe('{"value":"input"}')
  expect(form.get("constructor")).toBe("field")
  expect(form.get("text")).toBe("hello")
})
