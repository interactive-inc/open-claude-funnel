import { describe, expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import type { FunnelEventLog } from "@/gateway/event-log/event-log"

const stores: { name: string; create: () => FunnelEventLog }[] = [
  { name: "memory", create: () => new MemoryFunnelEventLog() },
  { name: "sqlite", create: () => new SqliteFunnelEventLog({ path: ":memory:" }) },
]

describe.each(stores)("delivery contracts with $name", ({ create }) => {
  test("an initially empty replay cannot duplicate live input arriving before the first read", async () => {
    const log = create()
    const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
      token: "",
      eventLog: log,
    })
    try {
      const events = gateway.events({ channel: "ops", since: 0 })
      gateway.emit({ channel: "ops", content: "one" })
      expect((await events.next()).value.content).toBe("one")
      gateway.emit({ channel: "ops", content: "two" })
      expect((await events.next()).value.content).toBe("two")
    } finally {
      await gateway.stop()
      log.close()
    }
  })

  test("a fast consumer can replay a backlog larger than its unread queue", async () => {
    const log = create()
    const funnel = new Funnel({ channels: [{ name: "ops" }, { name: "other" }] })
    const gateway = funnel.gatewayModule({ token: "", eventLog: log })
    try {
      for (let i = 1; i <= 1205; i++) {
        gateway.emit({ channel: i % 2 ? "ops" : "other", content: String(i) })
      }
      const events = gateway.events({ channel: "ops", since: 0, maxQueuedEvents: 1 })
      gateway.emit({ channel: "ops", content: "live" })
      for (let i = 1; i <= 1205; i += 2) {
        expect((await events.next()).value).toMatchObject({ offset: i, content: String(i) })
      }
      expect((await events.next()).value).toMatchObject({ offset: 1206, content: "live" })
      await events.return()
    } finally {
      await gateway.stop()
      log.close()
    }
  })

  test("an unread exclusive replay does not claim work before the consumer asks for it", async () => {
    const log = create()
    const funnel = new Funnel({ channels: [{ name: "ops", delivery: "exclusive" }] })
    const gateway = funnel.gatewayModule({ token: "", eventLog: log })
    try {
      gateway.emit({ channel: "ops", content: "queued" })
      const events = gateway.events({ channel: "ops", subscriberId: "unused", since: 0 })
      await events.return()
      expect(log.claimExclusive(1, funnel.channels.get("ops")!.id, "replacement")).toBe(true)
    } finally {
      await gateway.stop()
      log.close()
    }
  })

  test("native replay reads history in bounded pages instead of loading the entire durable log", async () => {
    const log = create()
    const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
      token: "",
      eventLog: log,
    })
    try {
      for (let i = 1; i <= 300; i++) gateway.emit({ channel: "ops", content: String(i) })
      expect(log.loadSince(10, 2).map((event) => event.offset)).toEqual([11, 12])
      expect(log.loadSince(10, 0)).toEqual([])
      const load = log.loadSince.bind(log)
      const limits: (number | undefined)[] = []
      log.loadSince = (since, limit) => {
        limits.push(limit)
        return load(since, limit)
      }
      const events = gateway.events({ channel: "ops", since: 0 })
      expect(limits).toEqual([])
      for (let i = 1; i <= 300; i++) expect((await events.next()).value.offset).toBe(i)
      expect(limits.length).toBeGreaterThan(0)
      expect(limits.every((limit) => limit === 64)).toBe(true)
      await events.return()
    } finally {
      await gateway.stop()
      log.close()
    }
  })

  test("replay source failure detaches the native consumer and surfaces its original error", async () => {
    const log = create()
    const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
      token: "",
      eventLog: log,
    })
    try {
      for (let i = 1; i <= 201; i++) gateway.emit({ channel: "ops", content: String(i) })
      log.loadSince = () => {
        throw new Error("read unavailable")
      }
      const events = gateway.events({ channel: "ops", since: 0 })
      await expect(events.next()).rejects.toThrow("read unavailable")
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    } finally {
      await gateway.stop()
      log.close()
    }
  })
})

test("a real SQLite write rejection prevents native and observer delivery", async () => {
  const log = new SqliteFunnelEventLog({ path: ":memory:" })
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
    token: "",
    eventLog: log,
  })
  const seen: string[] = []
  gateway.onEvent((event) => seen.push(event.content))
  const events = gateway.events({ channel: "ops" })
  try {
    // Another writer creates a PK collision after the gateway seeds its cursor.
    log.record({
      offset: 1,
      content: "already stored",
      channelId: null,
      connectorId: null,
      meta: null,
    })
    expect(() => gateway.emit({ channel: "ops", content: "must not deliver" })).toThrow()
    expect(seen).toEqual([])
    const pending = events.next()
    await events.return()
    expect((await pending).done).toBe(true)
    expect(log.loadSince(0).map((event) => event.content)).toEqual(["already stored"])
  } finally {
    await gateway.stop()
    log.close()
  }
})

test("producer metadata changes do not alter retained events or their routing", () => {
  const broadcaster = new FunnelBroadcaster()
  const meta = { channelId: "ops", value: "original" }
  broadcaster.broadcast("hello", meta)
  meta.channelId = "other"
  meta.value = "changed"
  const replay = broadcaster.replaySince(0, { channel: "ops", connectors: [] })
  expect(replay).toHaveLength(1)
  expect(replay[0]?.meta?.value).toBe("original")
})

test("an observer cannot corrupt another subscription or a later replay", () => {
  const broadcaster = new FunnelBroadcaster()
  const seen: string[] = []
  broadcaster.subscribe((event) => {
    Reflect.set(event, "content", "corrupted")
  })
  broadcaster.subscribe((event) => seen.push(event.content))
  const published = broadcaster.broadcast("original")
  expect(Object.isFrozen(published)).toBe(true)
  expect(seen).toEqual(["original"])
  expect(published.content).toBe("original")
  expect(broadcaster.replaySince(0, { channel: "ops", connectors: [] })[0]?.content).toBe(
    "original",
  )
})

test("memory event log does not retain the caller's mutable metadata", () => {
  const log = new MemoryFunnelEventLog()
  const meta = { channelId: "ops" }
  log.record({ offset: 1, content: "original", channelId: "ops", connectorId: null, meta })
  meta.channelId = "changed"
  expect(log.loadSince(0)[0]?.meta?.channelId).toBe("ops")
  const replay = log.loadSince(0)[0]!
  expect(Object.isFrozen(replay.meta)).toBe(true)
  Reflect.set(replay.meta!, "channelId", "corrupted")
  expect(log.loadSince(0)[0]?.meta?.channelId).toBe("ops")
})
