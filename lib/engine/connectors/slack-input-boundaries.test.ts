import { describe, expect, test } from "bun:test"
import { FunnelSlackEventProcessor, type SlackRawEvent } from "./slack-event-processor"

const event = (overrides: SlackRawEvent = {}): SlackRawEvent => ({
  type: "message",
  user: "OTHER",
  channel: "C1",
  ts: "1.0",
  text: "hello",
  ...overrides,
})

const processor = (ownBotUserId = "BOT", ownBotId = "BOT_ID") =>
  new FunnelSlackEventProcessor({ ownBotUserId, ownBotId, minify: false, now: () => 0 })

describe("Slack input boundaries", () => {
  test("rejects malformed subtypes without consuming the event identity", () => {
    for (const subtype of [null, 0, false, [], {}]) {
      const subject = processor()
      expect(subject.process(event({ subtype }))).toEqual({ skip: true, reason: "skip:subtype" })
      expect(subject.process(event()).skip).toBe(false)
    }
  })

  test("removes only the literal own mention", () => {
    const result = processor("B.OT").process(event({ text: "<@B.OT> hello <@BXOT>" }))
    expect(result.skip).toBe(false)
    if (result.skip || result.event.kind !== "message") throw new Error("Expected a message")
    expect(result.event.text).toBe("hello <@BXOT>")
    expect(result.shouldReact).toBe(true)
  })

  test("handles regex metacharacters in identities literally", () => {
    const result = processor("[BOT").process(event({ text: "<@[BOT> hello <@[BOT>" }))
    expect(result.skip).toBe(false)
    if (result.skip || result.event.kind !== "message") throw new Error("Expected a message")
    expect(result.event.text).toBe("hello")
  })

  test("unknown identity does not recognize or remove an empty mention", () => {
    const result = processor("", "").process(event({ text: "<@> placeholder" }))
    expect(result.skip).toBe(false)
    if (result.skip || result.event.kind !== "message") throw new Error("Expected a message")
    expect(result.event.text).toBe("<@> placeholder")
    expect(result.event.mentioned).toBe(false)
    expect(result.meta.mentioned).toBe("false")
    expect(result.shouldReact).toBe(false)
  })

  test("unknown identities do not classify empty author fields as self", () => {
    expect(processor("", "").process(event({ user: "", bot_id: "" })).skip).toBe(false)
  })
})
