import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

test("an exclusive channel named __proto__ retains its offline assignment", () => {
  const broadcaster = new FunnelBroadcaster({
    channels: () => [{ id: "__proto__", connectors: [], delivery: "exclusive" }],
  })
  const event = broadcaster.broadcast("offline", { channelId: "__proto__" })
  expect(Object.hasOwn(event.exclusive ?? {}, "__proto__")).toBe(true)
  expect(event.exclusive?.__proto__).toBe(null)
  const worker = {
    channel: "__proto__",
    connectors: [],
    delivery: "exclusive" as const,
    subscriberId: "first",
  }
  expect(broadcaster.replaySince(0, worker).map((row) => row.content)).toEqual(["offline"])
  expect(broadcaster.replaySince(0, { ...worker, subscriberId: "second" })).toEqual([])
  expect(broadcaster.replaySince(0, worker).map((row) => row.content)).toEqual(["offline"])
})

for (const channel of ["constructor", "toString", "__proto__"]) {
  test(`fanout replay for ${channel} ignores inherited exclusive properties`, () => {
    const broadcaster = new FunnelBroadcaster({
      channels: () => [{ id: "other", connectors: [], delivery: "exclusive" }],
    })
    broadcaster.broadcast("global")
    expect(
      broadcaster
        .replaySince(0, {
          channel,
          connectors: [],
          delivery: "fanout",
          subscriberId: "reader",
        })
        .map((row) => row.content),
    ).toEqual(["global"])
  })
}

for (const storage of ["memory", "sqlite"] as const) {
  test(`${storage} retains special channel assignments across broadcaster recreation`, () => {
    const log =
      storage === "memory"
        ? new MemoryFunnelEventLog()
        : new SqliteFunnelEventLog({ path: ":memory:" })
    try {
      const source = new FunnelBroadcaster({
        channels: () => [{ id: "__proto__", connectors: [], delivery: "exclusive" }],
        record: (event) =>
          log.record({
            ...event,
            meta: event.meta ?? null,
            channelId: "__proto__",
            connectorId: null,
          }),
      })
      source.broadcast("offline", { channelId: "__proto__" })
      const reconnect = () => {
        const broadcaster = new FunnelBroadcaster({ replayBufferSize: 0, persistentReplay: log })
        broadcaster.seedLatestOffset(log.findMaxOffset())
        return broadcaster
      }
      const worker = {
        channel: "__proto__",
        connectors: [],
        delivery: "exclusive" as const,
        subscriberId: "first",
      }
      expect(
        reconnect()
          .replaySince(0, worker)
          .map((row) => row.content),
      ).toEqual(["offline"])
      expect(reconnect().replaySince(0, { ...worker, subscriberId: "second" })).toEqual([])
      expect(
        reconnect()
          .replaySince(0, worker)
          .map((row) => row.content),
      ).toEqual(["offline"])
    } finally {
      log.close()
    }
  })
}
