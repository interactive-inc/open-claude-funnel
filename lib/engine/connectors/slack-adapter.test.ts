import { describe, expect, vi, test, beforeEach } from "vitest"
import { FunnelSlackAdapter } from "@/engine/connectors/slack-adapter"

const config = {
  type: "slack" as const,
  id: "slack-id",
  name: "test",
  botToken: "xoxb-test",
  appToken: "xapp-test",
  minify: true,
}

const mockResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("FunnelSlackAdapter", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  test("posts to https://slack.com/api/<path> with bearer token and form body", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(mockResponse({ ok: true }))

    const adapter = new FunnelSlackAdapter({ config })

    const result = await adapter.call({
      method: "post",
      path: "chat.postMessage",
      body: { channel: "D1", text: "hi" },
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer xoxb-test",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    )
    const callBody = fetchMock.mock.calls[0]![1]!.body as string

    expect(callBody).toContain("channel=D1")
    expect(callBody).toContain("text=hi")
  })

  test("passes empty body when input body is not an object", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(mockResponse({ ok: true }))

    const adapter = new FunnelSlackAdapter({ config })

    await adapter.call({ method: "post", path: "auth.test" })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/auth.test",
      expect.objectContaining({ method: "POST" }),
    )
  })

  test("returns Slack platform error body verbatim when ok=false", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(mockResponse({ ok: false, error: "channel_not_found" }))

    const adapter = new FunnelSlackAdapter({ config })

    const result = await adapter.call({
      method: "post",
      path: "chat.postMessage",
      body: { channel: "D1", text: "hi" },
    })

    expect(result).toEqual({ ok: false, error: "channel_not_found" })
  })

  test("returns Slack rate-limit payload the same way", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(mockResponse({ ok: false, error: "ratelimited", retryAfter: 30 }))

    const adapter = new FunnelSlackAdapter({ config })

    const result = await adapter.call({ method: "post", path: "chat.postMessage" })

    expect(result).toEqual({ ok: false, error: "ratelimited", retryAfter: 30 })
  })

  test("returns synthetic ok=false when response is not JSON", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }))

    const adapter = new FunnelSlackAdapter({ config })

    const result = await adapter.call({ method: "post", path: "auth.test" })

    expect(result).toEqual(expect.objectContaining({ ok: false }))
  })

  test("uses the injected FunnelHttpClient instead of globalThis.fetch", async () => {
    // Patch globalThis.fetch to throw so we can prove the adapter never
    // touches it when an http boundary is injected.
    globalThis.fetch = vi.fn(() => {
      throw new Error("global fetch must not be called when http is injected")
    }) as unknown as typeof fetch

    const { MemoryFunnelHttpClient } = await import("@/engine/http/memory-http-client")
    const http = new MemoryFunnelHttpClient().on(() => ({
      status: 200,
      body: JSON.stringify({ ok: true, captured: true }),
    }))

    const adapter = new FunnelSlackAdapter({ config, http })

    const result = await adapter.call({
      method: "post",
      path: "chat.postMessage",
      body: { channel: "D1", text: "hi" },
    })

    expect(result).toEqual({ ok: true, captured: true })
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0]!.url).toBe("https://slack.com/api/chat.postMessage")
    expect(http.calls[0]!.method).toBe("POST")
  })
})

describe("FunnelSlackAdapter domain methods", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch
  })

  test("postMessage sends chat.postMessage with thread_ts", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(mockResponse({ ok: true }))

    const adapter = new FunnelSlackAdapter({ config })

    await adapter.postMessage({ channel: "C1", text: "hello", threadTs: "1.0" })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({ method: "POST" }),
    )
    const body = fetchMock.mock.calls[0]![1]!.body as string

    expect(body).toContain("channel=C1")
    expect(body).toContain("text=hello")
    expect(body).toContain("thread_ts=1.0")
  })

  test("postMessage omits thread_ts when not provided", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(mockResponse({ ok: true }))

    const adapter = new FunnelSlackAdapter({ config })

    await adapter.postMessage({ channel: "C1", text: "hello" })

    const body = fetchMock.mock.calls[0]![1]!.body as string

    expect(body).toContain("channel=C1")
    expect(body).toContain("text=hello")
    expect(body).not.toContain("thread_ts")
  })

  test("addReaction sends reactions.add", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(mockResponse({ ok: true }))

    const adapter = new FunnelSlackAdapter({ config })

    await adapter.addReaction({ channel: "C1", timestamp: "1.0", name: "eyes" })

    const body = fetchMock.mock.calls[0]![1]!.body as string

    expect(body).toContain("channel=C1")
    expect(body).toContain("timestamp=1.0")
    expect(body).toContain("name=eyes")
  })

  test("removeReaction sends reactions.remove", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(mockResponse({ ok: true }))

    const adapter = new FunnelSlackAdapter({ config })

    await adapter.removeReaction({ channel: "C1", timestamp: "1.0", name: "eyes" })

    const body = fetchMock.mock.calls[0]![1]!.body as string

    expect(body).toContain("name=eyes")
  })
})
