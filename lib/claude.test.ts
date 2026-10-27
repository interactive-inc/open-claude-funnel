import { describe, expect, test } from "bun:test"
import {
  agentSdkInput,
  agentSdkMessage,
  claudeChannelCapabilities,
  claudeChannelNotification,
} from "@/claude"
import { Funnel } from "@/funnel"
import type { ReplayableEvent } from "@/gateway/broadcaster"

const event: ReplayableEvent = {
  content: "hello",
  meta: { channel: "ops", thread_ts: "123.456" },
  offset: 7,
}

describe("Claude composition values", () => {
  test("native SDK input preserves content and routing context without session ownership", () => {
    const message = agentSdkMessage(event)
    expect(message.type).toBe("user")
    expect(message.message.role).toBe("user")
    expect(JSON.parse(message.message.content)).toEqual(event)
    expect(message.parent_tool_use_id).toBeNull()
    expect(message.session_id).toBe("")
  })

  test("SDK input can be composed with other host-owned messages", async () => {
    const funnel = new Funnel({ channels: [{ name: "ops" }] })
    const gateway = funnel.gatewayModule({ token: "" })
    const events = gateway.events({ channel: "ops" })
    const input = agentSdkInput(events)
    try {
      gateway.emit({ channel: "ops", content: "first" })
      gateway.emit({ channel: "ops", content: "second" })
      expect(JSON.parse((await input.next()).value.message.content).content).toBe("first")
      expect(JSON.parse((await input.next()).value.message.content).content).toBe("second")
      const pending = input.next()
      await input.return!()
      expect((await pending).done).toBe(true)
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    } finally {
      await gateway.stop()
    }
  })

  test("source failure propagates through the input mapping", async () => {
    async function* source(): AsyncGenerator<ReplayableEvent> {
      yield event
      throw new Error("source failed")
    }
    const input = agentSdkInput(source())
    await input.next()
    await expect(input.next()).rejects.toThrow("source failed")
  })

  test("channel notification uses native MCP wire format and does not mutate the event", () => {
    expect(claudeChannelNotification(event)).toEqual({
      method: "notifications/claude/channel",
      params: {
        content: "hello",
        meta: { channel: "ops", thread_ts: "123.456", funnel_offset: "7" },
      },
    })
    expect(event.meta).not.toHaveProperty("funnel_offset")
    expect(claudeChannelCapabilities).toEqual({ experimental: { "claude/channel": {} } })
  })

  test("channel metadata forwards supported keys and reserves its own cursor", () => {
    expect(
      claudeChannelNotification({
        content: "unaltered <text>",
        offset: 9,
        meta: {
          "has-hyphen": "unsupported",
          "bad key": "unsupported",
          good_key: "value",
          funnel_offset: "spoofed",
        },
      }).params,
    ).toEqual({ content: "unaltered <text>", meta: { good_key: "value", funnel_offset: "9" } })
  })
})
