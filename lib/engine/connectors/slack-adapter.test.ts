import { describe, expect, vi, test } from "vitest"
import { FunnelSlackAdapter, type SlackWebClientLike } from "@/engine/connectors/slack-adapter"

const config = {
  type: "slack" as const,
  id: "slack-id",
  name: "test",
  botToken: "xoxb-test",
  appToken: "xapp-test",
  minify: true,
}

describe("FunnelSlackAdapter", () => {
  test("calls client.apiCall(path, body)", async () => {
    const apiCall = vi.fn(async () => ({ ok: true }))
    const client: SlackWebClientLike = { apiCall }

    const adapter = new FunnelSlackAdapter({ config, client })

    const result = await adapter.call({
      method: "post",
      path: "chat.postMessage",
      body: { channel: "D1", text: "hi" },
    })

    expect(result).toEqual({ ok: true })
    expect(apiCall).toHaveBeenCalledWith("chat.postMessage", { channel: "D1", text: "hi" })
  })

  test("passes {} when body is not an object", async () => {
    const apiCall = vi.fn(async () => ({ ok: true }))
    const client: SlackWebClientLike = { apiCall }

    const adapter = new FunnelSlackAdapter({ config, client })

    await adapter.call({ method: "post", path: "auth.test" })

    expect(apiCall).toHaveBeenCalledWith("auth.test", {})
  })

  test("unwraps Slack platform errors and returns response.data", async () => {
    const slackError = Object.assign(new Error("An API error occurred: channel_not_found"), {
      code: "slack_webapi_platform_error",
      data: { ok: false, error: "channel_not_found" },
    })
    const apiCall = vi.fn(async () => {
      throw slackError
    })
    const client: SlackWebClientLike = { apiCall }

    const adapter = new FunnelSlackAdapter({ config, client })

    const result = await adapter.call({
      method: "post",
      path: "chat.postMessage",
      body: { channel: "D1", text: "hi" },
    })

    expect(result).toEqual({ ok: false, error: "channel_not_found" })
  })

  test("unwraps Slack rate-limit errors the same way", async () => {
    const slackError = Object.assign(new Error("A rate limit was exceeded"), {
      code: "slack_webapi_rate_limited_error",
      data: { ok: false, error: "ratelimited", retryAfter: 30 },
    })
    const apiCall = vi.fn(async () => {
      throw slackError
    })
    const client: SlackWebClientLike = { apiCall }

    const adapter = new FunnelSlackAdapter({ config, client })

    const result = await adapter.call({ method: "post", path: "chat.postMessage" })

    expect(result).toEqual({ ok: false, error: "ratelimited", retryAfter: 30 })
  })

  test("rethrows non-Slack errors so infrastructure failures still surface as 500", async () => {
    const apiCall = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })
    const client: SlackWebClientLike = { apiCall }

    const adapter = new FunnelSlackAdapter({ config, client })

    await expect(adapter.call({ method: "post", path: "auth.test" })).rejects.toThrow(
      /ECONNREFUSED/,
    )
  })
})

describe("FunnelSlackAdapter domain methods", () => {
  test("postMessage sends chat.postMessage with thread_ts", async () => {
    const apiCall = vi.fn(async () => ({ ok: true }))
    const client: SlackWebClientLike = { apiCall }
    const adapter = new FunnelSlackAdapter({ config, client })

    await adapter.postMessage({ channel: "C1", text: "hello", threadTs: "1.0" })

    expect(apiCall).toHaveBeenCalledWith("chat.postMessage", {
      channel: "C1",
      text: "hello",
      thread_ts: "1.0",
    })
  })

  test("postMessage omits thread_ts when not provided", async () => {
    const apiCall = vi.fn(async () => ({ ok: true }))
    const client: SlackWebClientLike = { apiCall }
    const adapter = new FunnelSlackAdapter({ config, client })

    await adapter.postMessage({ channel: "C1", text: "hello" })

    expect(apiCall).toHaveBeenCalledWith("chat.postMessage", {
      channel: "C1",
      text: "hello",
    })
  })

  test("addReaction sends reactions.add", async () => {
    const apiCall = vi.fn(async () => ({ ok: true }))
    const client: SlackWebClientLike = { apiCall }
    const adapter = new FunnelSlackAdapter({ config, client })

    await adapter.addReaction({ channel: "C1", timestamp: "1.0", name: "eyes" })

    expect(apiCall).toHaveBeenCalledWith("reactions.add", {
      channel: "C1",
      timestamp: "1.0",
      name: "eyes",
    })
  })

  test("removeReaction sends reactions.remove", async () => {
    const apiCall = vi.fn(async () => ({ ok: true }))
    const client: SlackWebClientLike = { apiCall }
    const adapter = new FunnelSlackAdapter({ config, client })

    await adapter.removeReaction({ channel: "C1", timestamp: "1.0", name: "eyes" })

    expect(apiCall).toHaveBeenCalledWith("reactions.remove", {
      channel: "C1",
      timestamp: "1.0",
      name: "eyes",
    })
  })
})
