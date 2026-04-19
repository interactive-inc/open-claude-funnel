import { describe, expect, mock, test } from "bun:test"
import {
  FunnelSlackAdapter,
  type SlackWebClientLike,
} from "@/modules/connectors/funnel-slack-adapter"

const config = {
  type: "slack" as const,
  name: "test",
  botToken: "xoxb-test",
  appToken: "xapp-test",
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
})
