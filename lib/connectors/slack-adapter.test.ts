import { describe, expect, mock, test } from "bun:test"
import { FunnelSlackAdapter, type SlackWebClientLike } from "@/connectors/slack-adapter"

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
    const apiCall = mock(async () => ({ ok: true }))
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
    const apiCall = mock(async () => ({ ok: true }))
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
    const apiCall = mock(async () => {
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
    const apiCall = mock(async () => {
      throw slackError
    })
    const client: SlackWebClientLike = { apiCall }

    const adapter = new FunnelSlackAdapter({ config, client })

    const result = await adapter.call({ method: "post", path: "chat.postMessage" })

    expect(result).toEqual({ ok: false, error: "ratelimited", retryAfter: 30 })
  })

  test("rethrows non-Slack errors so infrastructure failures still surface as 500", async () => {
    const apiCall = mock(async () => {
      throw new Error("ECONNREFUSED")
    })
    const client: SlackWebClientLike = { apiCall }

    const adapter = new FunnelSlackAdapter({ config, client })

    await expect(adapter.call({ method: "post", path: "auth.test" })).rejects.toThrow(
      /ECONNREFUSED/,
    )
  })
})
