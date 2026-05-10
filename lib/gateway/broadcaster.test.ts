import { describe, expect, test } from "vitest"
import type { ServerWebSocket } from "bun"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { FunnelBroadcaster } from "@/gateway/broadcaster"

type FakeWsMode = "fast" | "slow"

class FakeWs {
  sent: string[] = []
  closed: { code?: number; reason?: string } | null = null

  constructor(private readonly mode: FakeWsMode = "fast") {}

  send(payload: string): void {
    this.sent.push(payload)
  }

  getBufferedAmount(): number {
    return this.mode === "slow" ? 10_000_000 : 0
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason }
  }
}

const asWs = (ws: FakeWs): ServerWebSocket<unknown> => ws as unknown as ServerWebSocket<unknown>

describe("FunnelBroadcaster", () => {
  test("subscribers receive every event with content + meta + offset", () => {
    const broadcaster = new FunnelBroadcaster()
    const events: { content: string; meta?: Record<string, string>; offset: number }[] = []

    broadcaster.subscribe((event) => events.push(event))
    broadcaster.broadcast("hi", { event_type: "test", connector: "demo" })

    expect(events).toEqual([
      { content: "hi", meta: { event_type: "test", connector: "demo" }, offset: 1 },
    ])
  })

  test("unsubscribe stops further deliveries", () => {
    const broadcaster = new FunnelBroadcaster()
    const events: { content: string }[] = []

    const unsubscribe = broadcaster.subscribe((event) => events.push({ content: event.content }))

    broadcaster.broadcast("first")
    unsubscribe()
    broadcaster.broadcast("second")

    expect(events).toEqual([{ content: "first" }])
  })

  test("a throwing subscriber does not break others or the WS broadcast", () => {
    const logger = new MemoryFunnelLogger()
    const broadcaster = new FunnelBroadcaster({ logger })
    const ws = new FakeWs()

    broadcaster.addClient(asWs(ws), { channel: "inbox", connectors: ["demo"] })
    broadcaster.subscribe(() => {
      throw new Error("boom")
    })

    const seen: string[] = []
    broadcaster.subscribe((event) => seen.push(event.content))

    broadcaster.broadcast("ping", { connector: "demo" })

    expect(seen).toEqual(["ping"])
    expect(ws.sent.length).toBe(1)
    expect(logger.error).not.toBeUndefined()
  })

  test("WS receives only events for connectors it subscribes to", () => {
    const broadcaster = new FunnelBroadcaster()
    const a = new FakeWs()
    const b = new FakeWs()

    broadcaster.addClient(asWs(a), { channel: "inbox", connectors: ["slack-a"] })
    broadcaster.addClient(asWs(b), { channel: "ops", connectors: ["slack-b"] })

    broadcaster.broadcast("hello", { connector: "slack-a" })

    expect(a.sent.length).toBe(1)
    expect(b.sent.length).toBe(0)
  })

  test("a slow client (over the buffered threshold) is closed and dropped", () => {
    const broadcaster = new FunnelBroadcaster({ maxBufferedBytes: 1024 })
    const slow = new FakeWs("slow")
    const fast = new FakeWs("fast")

    broadcaster.addClient(asWs(slow), { channel: "x", connectors: ["demo"] })
    broadcaster.addClient(asWs(fast), { channel: "y", connectors: ["demo"] })

    broadcaster.broadcast("payload", { connector: "demo" })

    expect(slow.closed?.code).toBe(1009)
    expect(slow.sent.length).toBe(0)
    expect(fast.sent.length).toBe(1)
    expect(broadcaster.getClientCount()).toBe(1)
  })

  test("each broadcast advances the offset by 1", () => {
    const broadcaster = new FunnelBroadcaster()

    broadcaster.broadcast("a")
    broadcaster.broadcast("b")
    broadcaster.broadcast("c")

    expect(broadcaster.getMetrics().latestOffset).toBe(3)
  })

  test("replaySince returns events strictly after the requested offset", () => {
    const broadcaster = new FunnelBroadcaster({ replayBufferSize: 10 })

    broadcaster.broadcast("a")
    broadcaster.broadcast("b")
    broadcaster.broadcast("c")

    const replay = broadcaster.replaySince(1, { channel: "x", connectors: [], tapAll: true })

    expect(replay.map((e) => e.content)).toEqual(["b", "c"])
    expect(replay.map((e) => e.offset)).toEqual([2, 3])
  })

  test("replaySince filters by connector subscription", () => {
    const broadcaster = new FunnelBroadcaster({ replayBufferSize: 10 })

    broadcaster.broadcast("a", { connector: "slack-a" })
    broadcaster.broadcast("b", { connector: "slack-b" })
    broadcaster.broadcast("c", { connector: "slack-a" })

    const replay = broadcaster.replaySince(0, {
      channel: "ops",
      connectors: ["slack-a"],
      tapAll: false,
    })

    expect(replay.map((e) => e.content)).toEqual(["a", "c"])
  })

  test("replay buffer is bounded by replayBufferSize", () => {
    const broadcaster = new FunnelBroadcaster({ replayBufferSize: 2 })

    broadcaster.broadcast("a")
    broadcaster.broadcast("b")
    broadcaster.broadcast("c")

    const replay = broadcaster.replaySince(0, { channel: "x", connectors: [], tapAll: true })

    expect(replay.map((e) => e.content)).toEqual(["b", "c"])
    expect(broadcaster.getMetrics().oldestReplayableOffset).toBe(2)
  })

  test("replayBufferSize=0 disables replay entirely", () => {
    const broadcaster = new FunnelBroadcaster({ replayBufferSize: 0 })

    broadcaster.broadcast("a")

    const replay = broadcaster.replaySince(0, { channel: "x", connectors: [], tapAll: true })

    expect(replay).toEqual([])
    expect(broadcaster.getMetrics().latestOffset).toBe(1)
  })

  test("replaySince falls back to persistentReplay when since predates the in-memory buffer", () => {
    const broadcaster = new FunnelBroadcaster({
      replayBufferSize: 2,
      persistentReplay: {
        loadSince: (since) =>
          [
            { content: "old-1", meta: {}, offset: 1 },
            { content: "old-2", meta: {}, offset: 2 },
            { content: "old-3", meta: {}, offset: 3 },
          ].filter((e) => e.offset > since),
      },
    })

    broadcaster.seedLatestOffset(3)
    broadcaster.broadcast("live-4")
    broadcaster.broadcast("live-5")

    const replay = broadcaster.replaySince(0, { channel: "x", connectors: [], tapAll: true })

    expect(replay.map((e) => e.content)).toEqual(["old-1", "old-2", "old-3", "live-4", "live-5"])
    expect(replay.map((e) => e.offset)).toEqual([1, 2, 3, 4, 5])
  })

  test("replaySince does not double-count events that exist in both memory and the persistent store", () => {
    const broadcaster = new FunnelBroadcaster({
      replayBufferSize: 5,
      persistentReplay: {
        loadSince: () => [
          { content: "a", meta: {}, offset: 1 },
          { content: "b", meta: {}, offset: 2 },
        ],
      },
    })

    broadcaster.broadcast("a")
    broadcaster.broadcast("b")

    const replay = broadcaster.replaySince(0, { channel: "x", connectors: [], tapAll: true })

    expect(replay.map((e) => e.content)).toEqual(["a", "b"])
  })

  test("seedLatestOffset only advances forward", () => {
    const broadcaster = new FunnelBroadcaster()

    broadcaster.seedLatestOffset(10)
    broadcaster.broadcast("x")

    expect(broadcaster.getMetrics().latestOffset).toBe(11)

    broadcaster.seedLatestOffset(5)
    broadcaster.broadcast("y")

    expect(broadcaster.getMetrics().latestOffset).toBe(12)
  })

  test("exclusive delivery picks one client per channel via round-robin", () => {
    const broadcaster = new FunnelBroadcaster()
    const a = new FakeWs()
    const b = new FakeWs()
    const c = new FakeWs()

    broadcaster.addClient(asWs(a), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "exclusive",
    })
    broadcaster.addClient(asWs(b), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "exclusive",
    })
    broadcaster.addClient(asWs(c), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "exclusive",
    })

    broadcaster.broadcast("e1", { connector: "slack-x" })
    broadcaster.broadcast("e2", { connector: "slack-x" })
    broadcaster.broadcast("e3", { connector: "slack-x" })
    broadcaster.broadcast("e4", { connector: "slack-x" })

    // Each event goes to exactly one client
    const total = a.sent.length + b.sent.length + c.sent.length
    expect(total).toBe(4)
    // Round-robin: each client gets at least 1, at most 2
    expect(a.sent.length).toBeGreaterThanOrEqual(1)
    expect(b.sent.length).toBeGreaterThanOrEqual(1)
    expect(c.sent.length).toBeGreaterThanOrEqual(1)
  })

  test("exclusive routing tracks separate cursors per channel", () => {
    const broadcaster = new FunnelBroadcaster()
    const opsA = new FakeWs()
    const opsB = new FakeWs()
    const dev = new FakeWs()

    broadcaster.addClient(asWs(opsA), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "exclusive",
    })
    broadcaster.addClient(asWs(opsB), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "exclusive",
    })
    broadcaster.addClient(asWs(dev), {
      channel: "dev",
      connectors: ["slack-x"],
      delivery: "exclusive",
    })

    broadcaster.broadcast("e1", { connector: "slack-x" })
    broadcaster.broadcast("e2", { connector: "slack-x" })

    expect(dev.sent.length).toBe(2)
    expect(opsA.sent.length + opsB.sent.length).toBe(2)
  })

  test("tap=all clients receive every event regardless of channel mode", () => {
    const broadcaster = new FunnelBroadcaster()
    const tap = new FakeWs()
    const exclusive1 = new FakeWs()
    const exclusive2 = new FakeWs()

    broadcaster.addClient(asWs(tap), { channel: "*tap*", connectors: [], tapAll: true })
    broadcaster.addClient(asWs(exclusive1), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "exclusive",
    })
    broadcaster.addClient(asWs(exclusive2), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "exclusive",
    })

    broadcaster.broadcast("e1", { connector: "slack-x" })
    broadcaster.broadcast("e2", { connector: "slack-x" })

    expect(tap.sent.length).toBe(2)
    expect(exclusive1.sent.length + exclusive2.sent.length).toBe(2)
  })

  test("fanout (default) preserves prior behavior — every matching client receives", () => {
    const broadcaster = new FunnelBroadcaster()
    const a = new FakeWs()
    const b = new FakeWs()

    broadcaster.addClient(asWs(a), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "fanout",
    })
    broadcaster.addClient(asWs(b), {
      channel: "ops",
      connectors: ["slack-x"],
      delivery: "fanout",
    })

    broadcaster.broadcast("e", { connector: "slack-x" })

    expect(a.sent.length).toBe(1)
    expect(b.sent.length).toBe(1)
  })
})
