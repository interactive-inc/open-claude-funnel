import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"

const worker = "worker-😀".repeat(32)
const subscription = {
  channel: "ops",
  connectors: [],
  delivery: "exclusive" as const,
  subscriberId: worker,
}

test("memory log byte caps include stored exclusive assignments", () => {
  const log = new MemoryFunnelEventLog({ maxBytes: 64 })
  log.record({
    offset: 1,
    content: "a",
    channelId: null,
    connectorId: null,
    meta: null,
    exclusive: { ops: worker },
  })
  expect(log.loadSince(0)).toEqual([])
  expect(log.findMaxOffset()).toBe(1)
})

test("memory log claims enforce byte caps and leave accounting usable after eviction", () => {
  const log = new MemoryFunnelEventLog({ maxBytes: 64 })
  log.record({
    offset: 1,
    content: "a",
    channelId: null,
    connectorId: null,
    meta: null,
    exclusive: { ops: null },
  })
  expect(log.claimExclusive(1, "ops", worker)).toBe(true)
  expect(log.loadSince(0)).toEqual([])
  log.record({
    offset: 2,
    content: "retry",
    channelId: null,
    connectorId: null,
    meta: null,
    exclusive: { ops: null },
  })
  expect(log.loadSince(0).map((event) => event.content)).toEqual(["retry"])
})

test("broadcaster byte caps bound assignments without dropping live delivery", async () => {
  const broadcaster = new FunnelBroadcaster({ replayBufferMaxBytes: 64 })
  const stream = broadcaster.events(subscription)
  try {
    broadcaster.broadcast("live", { channelId: "ops" })
    expect((await stream.next()).value.content).toBe("live")
    expect(broadcaster.replaySince(0, subscription)).toEqual([])
  } finally {
    await stream.return()
  }
})

test("in-memory replay claims account for ownership growth and evict oversized history", () => {
  const broadcaster = new FunnelBroadcaster({
    replayBufferMaxBytes: 64,
    channels: () => [{ id: "ops", connectors: [], delivery: "exclusive" }],
  })
  broadcaster.broadcast("offline", { channelId: "ops" })
  expect(broadcaster.replaySince(0, subscription).map((event) => event.content)).toEqual([
    "offline",
  ])
  expect(broadcaster.replaySince(0, subscription)).toEqual([])
  broadcaster.broadcast("retry", { channelId: "ops" })
  expect(
    broadcaster
      .replaySince(1, { ...subscription, subscriberId: "small" })
      .map((event) => event.content),
  ).toEqual(["retry"])
})

test("persistent claims also account for ownership cached in the memory replay buffer", () => {
  let claims = 0
  const broadcaster = new FunnelBroadcaster({
    replayBufferMaxBytes: 64,
    channels: () => [{ id: "ops", connectors: [], delivery: "exclusive" }],
    persistentReplay: {
      loadSince: () => [],
      claimExclusive: () => {
        claims++
        return true
      },
    },
  })
  broadcaster.broadcast("offline", { channelId: "ops" })
  expect(broadcaster.replaySince(0, subscription).map((event) => event.content)).toEqual([
    "offline",
  ])
  expect(broadcaster.replaySince(0, subscription)).toEqual([])
  expect(claims).toBe(1)
})
