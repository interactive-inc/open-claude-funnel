import { expect, test } from "bun:test"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { Funnel } from "@/funnel"
import type { FunnelEventLog } from "@/gateway/event-log/event-log"

const record = (store: FunnelEventLog, offset: number, content = String(offset)) =>
  store.record({ offset, content, channelId: null, connectorId: null, meta: null })

for (const type of ["memory", "sqlite"] as const) {
  const createStore = (maxRows?: number) =>
    type === "memory"
      ? new MemoryFunnelEventLog({ maxRows })
      : new SqliteFunnelEventLog({ path: ":memory:", maxRows })

  test(`${type} replays out-of-order writes in ascending offset order with correct pagination`, async () => {
    const store = createStore()
    for (const offset of [3, 1, 2]) record(store, offset)
    const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
      token: "",
      eventLog: store,
    })
    const events = gateway.events({ channel: "ops", since: 0 })
    try {
      expect(store.loadSince(0).map((event) => event.offset)).toEqual([1, 2, 3])
      expect(store.loadSince(1, 1).map((event) => event.offset)).toEqual([2])
      expect(store.findMaxOffset()).toBe(3)
      const delivered: number[] = []
      for (let index = 0; index < 3; index++) delivered.push((await events.next()).value.offset)
      expect(delivered).toEqual([1, 2, 3])
    } finally {
      await events.return()
      await gateway.stop()
      store.close()
    }
  })

  test(`${type} rejects invalid replay bounds even without retained rows`, () => {
    const store = createStore()
    try {
      for (const populated of [false, true]) {
        if (populated) for (const offset of [1, 2, 3]) record(store, offset)
        for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
          expect(() => store.loadSince(invalid, 1)).toThrow("non-negative safe integer")
          expect(() => store.loadSince(0, invalid)).toThrow("non-negative safe integer")
        }
      }
      expect(store.loadSince(0, 0)).toEqual([])
      expect(store.loadSince(1, 1).map((event) => event.offset)).toEqual([2])
      expect(store.loadSince(0).map((event) => event.offset)).toEqual([1, 2, 3])
      expect(store.loadSince(Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(store.findMaxOffset()).toBe(3)
    } finally {
      store.close()
    }
  })

  test(`${type} rejects duplicate retained offsets without replacing their original content`, () => {
    const store = createStore()
    try {
      record(store, 1, "original")
      expect(() => record(store, 1, "duplicate")).toThrow()
      expect(store.loadSince(0).map((event) => event.content)).toEqual(["original"])
      expect(store.findMaxOffset()).toBe(1)
      record(store, 2, "later")
      expect(store.loadSince(0).map((event) => event.content)).toEqual(["original", "later"])
    } finally {
      store.close()
    }
  })

  test(`${type} retention removes the oldest offsets when older records arrive late`, () => {
    const store = createStore(2)
    try {
      for (const offset of [4, 5, 3]) record(store, offset)
      expect(store.loadSince(0).map((event) => event.offset)).toEqual([4, 5])
      expect(store.findMaxOffset()).toBe(5)
    } finally {
      store.close()
    }
  })
}

test("invalid offsets cannot poison the memory log or add replay rows", () => {
  const store = new MemoryFunnelEventLog()
  record(store, 1, "original")
  for (const offset of [-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => record(store, offset, "invalid")).toThrow("positive safe integer")
    expect(store.findMaxOffset()).toBe(1)
    expect(store.loadSince(0).map((event) => event.content)).toEqual(["original"])
  }
})

test("failed metadata snapshots do not advance the memory log watermark", () => {
  const store = new MemoryFunnelEventLog()
  record(store, 1, "original")
  const meta = {
    get detail(): string {
      throw new Error("metadata unavailable")
    },
  }
  expect(() =>
    store.record({ offset: 2, content: "failed", channelId: null, connectorId: null, meta }),
  ).toThrow("metadata unavailable")
  expect(store.findMaxOffset()).toBe(1)
  expect(store.loadSince(0).map((event) => event.content)).toEqual(["original"])
  record(store, 2, "retry")
  expect(store.loadSince(0).map((event) => event.content)).toEqual(["original", "retry"])
})

test("failed exclusive snapshots do not leave phantom bytes that evict later events", () => {
  const store = new MemoryFunnelEventLog({ maxBytes: 3 })
  record(store, 1, "a")
  const exclusive = {
    get channel(): string {
      throw new Error("assignment unavailable")
    },
  }
  expect(() =>
    store.record({
      offset: 2,
      content: "x",
      channelId: null,
      connectorId: null,
      meta: null,
      exclusive,
    }),
  ).toThrow("assignment unavailable")
  expect(store.findMaxOffset()).toBe(1)
  record(store, 2, "b")
  expect(store.loadSince(0).map((event) => event.content)).toEqual(["b"])
})
