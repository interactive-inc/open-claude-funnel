import { describe, expect, it } from "vitest"
import { FunnelEventStore } from "@/gateway/funnel-event-store"

describe("FunnelEventStore", () => {
  it("returns 0 from findMaxOffset on a fresh database", () => {
    const store = new FunnelEventStore({ path: ":memory:" })
    expect(store.findMaxOffset()).toBe(0)
    store.close()
  })

  it("record persists with the caller-provided offset and findMaxOffset reflects it", () => {
    const store = new FunnelEventStore({ path: ":memory:" })

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
    const store = new FunnelEventStore({ path: ":memory:" })

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
    const store = new FunnelEventStore({ path: ":memory:" })

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
    const store = new FunnelEventStore({ path: ":memory:" })
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
    const store = new FunnelEventStore({ path: ":memory:" })

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
})
