import { describe, expect, test } from "vitest"
import { FunnelSlackEventProcessor } from "@/engine/connectors/slack-event-processor"

const make = () => new FunnelSlackEventProcessor({ ownBotUserId: "UBOT", ownBotId: "BBOT" })

describe("FunnelSlackEventProcessor", () => {
  test("skips disallowed event types", () => {
    const result = make().process({ type: "reaction_added" })

    expect(result.skip).toBe(true)
    if (result.skip) expect(result.reason).toBe("skip:type")
  })

  test("skips disallowed subtypes", () => {
    const result = make().process({ type: "message", subtype: "channel_join" })

    expect(result.skip).toBe(true)
    if (result.skip) expect(result.reason).toBe("skip:subtype")
  })

  test("skips messages from self", () => {
    const result = make().process({
      type: "message",
      user: "UBOT",
      channel: "C1",
      ts: "1.0",
    })

    expect(result.skip).toBe(true)
    if (result.skip) expect(result.reason).toBe("skip:self-user")
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
      expect(result.event.kind).toBe("message")
      expect(result.event.channel).toBe("C1")
      expect(result.event.user).toBe("UOTHER")
      expect(result.event.text).toBe("hello")
      expect(result.event.mentioned).toBe(false)
      expect(result.event.source).toBe("message")
      expect(result.event.isThreadRoot).toBe(true)
    }
  })

  test("mention sets shouldReact=true and strips mention from text", () => {
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
      expect(result.event.mentioned).toBe(true)
      expect(result.event.rawText).toBe("hi <@UBOT>!")
      expect(result.event.text).toBe("hi !")
    }
  })

  test("app_mention sets source to app_mention", () => {
    const result = make().process({
      type: "app_mention",
      user: "UOTHER",
      channel: "C1",
      ts: "2.0",
      text: "<@UBOT> ping",
    })

    expect(result.skip).toBe(false)
    if (!result.skip) {
      expect(result.event.source).toBe("app_mention")
      expect(result.event.text).toBe("ping")
    }
  })

  test("thread message has isThreadRoot=false", () => {
    const result = make().process({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "2.0",
      thread_ts: "1.0",
      text: "reply",
    })

    expect(result.skip).toBe(false)
    if (!result.skip) {
      expect(result.event.isThreadRoot).toBe(false)
      expect(result.event.threadTs).toBe("1.0")
    }
  })

  test("skips duplicate (channel, ts) pairs", () => {
    const p = make()
    const event = { type: "message", user: "UOTHER", channel: "C1", ts: "1.0", text: "a" }

    expect(p.process(event).skip).toBe(false)
    const second = p.process(event)
    expect(second.skip).toBe(true)
    if (second.skip) expect(second.reason).toBe("skip:dedup")
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
