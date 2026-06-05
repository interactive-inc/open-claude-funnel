import { describe, expect, it } from "bun:test"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { SqliteFunnelEventLog } from "@/gateway/sqlite-funnel-event-log"

describe("SqliteFunnelEventLog", () => {
  it("returns 0 from findMaxOffset on a fresh database", () => {
    const store = new SqliteFunnelEventLog({ path: ":memory:" })
    expect(store.findMaxOffset()).toBe(0)
    store.close()
  })

  it("record persists with the caller-provided offset and findMaxOffset reflects it", () => {
    const store = new SqliteFunnelEventLog({ path: ":memory:" })

    store.record({
      content: "hello",
      channelId: "c1",
      connectorId: "k1",
      meta: { event_type: "msg" },
      offset: 1,
    })
    store.record({
      content: "world",
      channelId: "c1",
      connectorId: "k2",
      meta: { event_type: "msg" },
      offset: 5,
    })

    expect(store.findMaxOffset()).toBe(5)
    store.close()
  })

  it("loadSince returns events with offset > since", () => {
    const store = new SqliteFunnelEventLog({ path: ":memory:" })

    for (const offset of [1, 2, 3]) {
      store.record({
        content: `event-${offset}`,
        channelId: "c1",
        connectorId: "k1",
        meta: null,
        offset,
      })
    }

    const recent = store.loadSince(1)
    expect(recent.map((e) => e.offset)).toEqual([2, 3])
    expect(recent[0]?.content).toBe("event-2")

    store.close()
  })

  it("loadForChannel filters by channel and optionally connector", () => {
    const store = new SqliteFunnelEventLog({ path: ":memory:" })

    store.record({
      content: "a",
      channelId: "c1",
      connectorId: "k1",
      meta: null,
      offset: 1,
    })
    store.record({
      content: "b",
      channelId: "c1",
      connectorId: "k2",
      meta: null,
      offset: 2,
    })
    store.record({
      content: "c",
      channelId: "c2",
      connectorId: "k1",
      meta: null,
      offset: 3,
    })

    const c1 = store.loadForChannel({ channelId: "c1" })
    expect(c1.map((e) => e.offset)).toEqual([1, 2])

    const c1k2 = store.loadForChannel({ channelId: "c1", connectorId: "k2" })
    expect(c1k2.map((e) => e.offset)).toEqual([2])

    store.close()
  })

  it("truncates content at 2000 chars", () => {
    const store = new SqliteFunnelEventLog({ path: ":memory:" })
    const long = "a".repeat(2500)
    store.record({
      content: long,
      channelId: null,
      connectorId: null,
      meta: null,
      offset: 1,
    })

    const records = store.loadSince(0)
    expect(records[0]?.content.length).toBe(2003)
    expect(records[0]?.content.endsWith("...")).toBe(true)

    store.close()
  })

  it("preserves meta when present and stores null when absent", () => {
    const store = new SqliteFunnelEventLog({ path: ":memory:" })

    store.record({
      content: "with-meta",
      channelId: null,
      connectorId: null,
      meta: { foo: "bar" },
      offset: 1,
    })
    store.record({
      content: "no-meta",
      channelId: null,
      connectorId: null,
      meta: null,
      offset: 2,
    })

    const records = store.loadSince(0)
    expect(records[0]?.meta).toEqual({ foo: "bar" })
    expect(records[1]?.meta).toBeUndefined()

    store.close()
  })

  it("surfaces a dropped write (duplicate offset) to the injected logger", () => {
    const logger = new MemoryFunnelLogger()
    const store = new SqliteFunnelEventLog({ path: ":memory:", logger })

    store.record({ content: "first", channelId: null, connectorId: null, meta: null, offset: 7 })

    // Re-using offset 7 collides with the INTEGER PRIMARY KEY, so the sink write
    // fails. The event log must surface it instead of dropping it silently.
    store.record({ content: "dup", channelId: null, connectorId: null, meta: null, offset: 7 })

    const errors = logger.entries.filter((entry) => entry.level === "error")

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toBe("event log write failed")
    expect(errors[0]?.meta?.offset).toBe(7)

    store.close()
  })

  it("logs nothing on a clean write", () => {
    const logger = new MemoryFunnelLogger()
    const store = new SqliteFunnelEventLog({ path: ":memory:", logger })

    store.record({ content: "ok", channelId: null, connectorId: null, meta: null, offset: 1 })

    expect(logger.entries).toEqual([])

    store.close()
  })
})
