import { describe, expect, test } from "bun:test"
import { FunnelSlackEventProcessor } from "@/connectors/slack-event-processor"

const make = () => new FunnelSlackEventProcessor({ ownBotUserId: "UBOT", ownBotId: "BBOT" })

describe("FunnelSlackEventProcessor", () => {
  test("skips disallowed event types", () => {
    const result = make().process({ type: "reaction_added" })

    expect(result.skip).toBe(true)
  })

  test("skips disallowed subtypes", () => {
    const result = make().process({ type: "message", subtype: "channel_join" })

    expect(result.skip).toBe(true)
  })

  test("skips messages from self", () => {
    const result = make().process({
      type: "message",
      user: "UBOT",
      channel: "C1",
      ts: "1.0",
    })

    expect(result.skip).toBe(true)
  })

  test("emits on regular messages", () => {
    const result = make().process({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "1.0",
      text: "hello",
    })

    expect(result.skip).toBe(false)
    if (!result.skip) {
      expect(result.meta.event_type).toBe("slack")
      expect(result.meta.channel_id).toBe("C1")
      expect(result.meta.mentioned).toBe("false")
      expect(result.shouldReact).toBe(false)
    }
  })

  test("mention sets shouldReact=true", () => {
    const result = make().process({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "1.0",
      text: "hi <@UBOT>!",
    })

    expect(result.skip).toBe(false)
    if (!result.skip) {
      expect(result.meta.mentioned).toBe("true")
      expect(result.shouldReact).toBe(true)
    }
  })

  test("skips duplicate (channel, ts) pairs", () => {
    const p = make()
    const event = { type: "message", user: "UOTHER", channel: "C1", ts: "1.0", text: "a" }

    expect(p.process(event).skip).toBe(false)
    expect(p.process(event).skip).toBe(true)
  })

  test("minifies content by default", () => {
    const result = make().process({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "1.0",
      text: "hello",
      client_msg_id: "abc-123",
      team: "T1",
    })

    expect(result.skip).toBe(false)
    if (result.skip) return

    const parsed = JSON.parse(result.content)

    expect(parsed.text).toBe("hello")
    expect(parsed).not.toHaveProperty("client_msg_id")
    expect(parsed).not.toHaveProperty("team")
  })

  test("keeps raw JSON when minify is disabled", () => {
    const processor = new FunnelSlackEventProcessor({
      ownBotUserId: "UBOT",
      ownBotId: "BBOT",
      minify: false,
    })
    const result = processor.process({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "1.0",
      text: "hello",
      client_msg_id: "abc-123",
      team: "T1",
    })

    expect(result.skip).toBe(false)
    if (result.skip) return

    const parsed = JSON.parse(result.content)

    expect(parsed.client_msg_id).toBe("abc-123")
    expect(parsed.team).toBe("T1")
  })
})
