import { describe, expect, test } from "bun:test"
import { FunnelSlackEventProcessor } from "@/modules/connectors/funnel-slack-event-processor"

const make = () =>
  new FunnelSlackEventProcessor({ ownBotUserId: "UBOT", ownBotId: "BBOT" })

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
})
