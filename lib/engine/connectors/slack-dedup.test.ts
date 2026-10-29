import { expect, test } from "bun:test"
import {
  FunnelSlackEventProcessor,
  type SlackRawEvent,
} from "@/engine/connectors/slack-event-processor"

const event = { type: "message", user: "USER", channel: "C1", ts: "1.0", text: "hello" }
const make = (now: () => number = () => 0) =>
  new FunnelSlackEventProcessor({ ownBotUserId: "BOT", ownBotId: "BOT_ID", minify: false, now })

test("Slack duplicate detection expires even without an intervening new event", () => {
  let now = 0
  const processor = make(() => now)
  expect(processor.process(event).skip).toBe(false)
  now = 10_000
  expect(processor.process(event)).toEqual({ skip: true, reason: "skip:dedup" })
  now++
  expect(processor.process(event).skip).toBe(false)
  expect(processor.process(event)).toEqual({ skip: true, reason: "skip:dedup" })
})

test("expired duplicate results do not depend on unrelated channel traffic", () => {
  let now = 0
  const idle = make(() => now)
  const busy = make(() => now)
  idle.process(event)
  busy.process(event)
  now = 10_001
  busy.process({ ...event, channel: "other", ts: "2.0" })
  expect(idle.process(event).skip).toBe(busy.process(event).skip)
})

test("Slack duplicate keys cannot collide when identity fields contain a separator", () => {
  const processor = make()
  expect(processor.process({ ...event, channel: "a:b", event_ts: "c" }).skip).toBe(false)
  expect(processor.process({ ...event, channel: "a", event_ts: "b:c" }).skip).toBe(false)
})

test("blank event_ts falls back to the actual message timestamp", () => {
  const processor = make()
  const first = { ...event, event_ts: "" }
  expect(processor.process(first).skip).toBe(false)
  expect(processor.process({ ...first, ts: "2.0" }).skip).toBe(false)
  expect(processor.process(first)).toEqual({ skip: true, reason: "skip:dedup" })
})

for (const missing of ["channel", "ts"] as const) {
  test(`messages without ${missing} cannot be falsely deduplicated using an empty identity`, () => {
    const processor = make()
    const first: SlackRawEvent = { ...event }
    delete first[missing]
    expect(processor.process(first).skip).toBe(false)
    expect(processor.process({ ...first, text: "different input" }).skip).toBe(false)
  })
}

test("failed Slack serialization cannot consume the duplicate identity before retry", () => {
  const processor = make()
  const invalid: SlackRawEvent = { ...event }
  invalid.circular = invalid
  expect(() => processor.process(invalid)).toThrow()
  expect(processor.process(event).skip).toBe(false)
  expect(processor.process(event)).toEqual({ skip: true, reason: "skip:dedup" })
})

test("a Slack transform that produces no JSON cannot consume the duplicate identity", () => {
  const processor = make()
  expect(() => processor.process({ ...event, toJSON: () => undefined })).toThrow(
    "could not be serialized",
  )
  expect(processor.process(event).skip).toBe(false)
})

test("invalid Slack clocks fail before delivery and cannot poison retry history", () => {
  for (const invalid of [NaN, Infinity, -Infinity, 8.64e15 + 1]) {
    let now = invalid
    const processor = make(() => now)
    expect(() => processor.process(event)).toThrow("time must be a valid timestamp")
    now = 0
    expect(processor.process(event).skip).toBe(false)
    expect(processor.process(event)).toEqual({ skip: true, reason: "skip:dedup" })
  }
})

test("an invalid Slack clock cannot bypass an existing duplicate", () => {
  let now = 0
  const processor = make(() => now)
  expect(processor.process(event).skip).toBe(false)
  now = NaN
  expect(() => processor.process(event)).toThrow("time must be a valid timestamp")
  now = 1
  expect(processor.process(event)).toEqual({ skip: true, reason: "skip:dedup" })
  now = 10_001
  expect(processor.process(event).skip).toBe(false)
})
