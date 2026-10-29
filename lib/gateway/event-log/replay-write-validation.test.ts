import { expect, test } from "bun:test"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import type { FunnelEventRecord } from "@/gateway/event-log/event-log"

for (const type of ["memory", "sqlite"] as const) {
  for (const field of ["detail", "event_type"] as const) {
    test(`${type} captures metadata ${field} once before validation and storage`, () => {
      const log =
        type === "memory"
          ? new MemoryFunnelEventLog()
          : new SqliteFunnelEventLog({ path: ":memory:" })
      let reads = 0
      const meta = Object.defineProperty({}, field, {
        enumerable: true,
        get: () => (++reads === 1 ? "first" : "changed"),
      })
      try {
        log.record({ offset: 1, content: "history", channelId: null, connectorId: null, meta })
        expect(log.loadSince(0)[0]?.meta?.[field]).toBe("first")
        expect(reads).toBe(1)
      } finally {
        log.close()
      }
    })
  }

  test(`${type} stores the exclusive assignment that was validated`, () => {
    const log =
      type === "memory"
        ? new MemoryFunnelEventLog()
        : new SqliteFunnelEventLog({ path: ":memory:" })
    let reads = 0
    const exclusive = {
      get ops() {
        return ++reads === 1 ? null : "other-worker"
      },
    }
    try {
      log.record({
        offset: 1,
        content: "history",
        channelId: "ops",
        connectorId: null,
        meta: null,
        exclusive,
      })
      expect(log.loadSince(0)[0]?.exclusive?.ops).toBeNull()
      expect(log.claimExclusive(1, "ops", "worker")).toBe(true)
      expect(log.claimExclusive(1, "ops", "other-worker")).toBe(false)
      expect(reads).toBe(1)
    } finally {
      log.close()
    }
  })

  test(`${type} rejects malformed replay payloads without retaining them or advancing offsets`, () => {
    const log =
      type === "memory"
        ? new MemoryFunnelEventLog()
        : new SqliteFunnelEventLog({ path: ":memory:" })
    const record: FunnelEventRecord = {
      offset: 1,
      content: "original",
      channelId: null,
      connectorId: null,
      meta: null,
    }
    try {
      log.record(record)
      for (const invalid of [
        { content: new Uint8Array([65]) },
        { meta: "invalid" },
        { meta: [] },
        { meta: new Map() },
        { meta: new Date(0) },
        { meta: { detail: 42 } },
        { meta: JSON.parse('{"__proto__":42}') },
        { exclusive: { ops: 42 } },
        { exclusive: JSON.parse('{"__proto__":42}') },
        { exclusive: null },
        { exclusive: false },
        { exclusive: [] },
        { exclusive: new Set() },
      ]) {
        expect(() => log.record({ ...record, offset: 2, ...invalid } as FunnelEventRecord)).toThrow(
          "replay event data is invalid",
        )
        expect(log.findMaxOffset()).toBe(1)
        expect(log.loadSince(0).map((event) => event.content)).toEqual(["original"])
      }
      log.record({ ...record, offset: 2, content: "retry" })
      expect(log.loadSince(0).map((event) => event.content)).toEqual(["original", "retry"])
    } finally {
      log.close()
    }
  })

  test(`${type} detaches valid replay dictionaries while preserving special keys`, () => {
    const log =
      type === "memory"
        ? new MemoryFunnelEventLog()
        : new SqliteFunnelEventLog({ path: ":memory:" })
    const meta = JSON.parse('{"__proto__":"detail"}')
    const exclusive = JSON.parse('{"__proto__":null}')
    try {
      log.record({
        offset: 1,
        content: "history",
        channelId: null,
        connectorId: null,
        meta,
        exclusive,
      })
      meta.__proto__ = "changed"
      exclusive.__proto__ = "different-worker"
      const replay = log.loadSince(0)[0]!
      expect(Object.hasOwn(replay.meta ?? {}, "__proto__")).toBe(true)
      expect(replay.meta?.__proto__).toBe("detail")
      expect(Object.hasOwn(replay.exclusive ?? {}, "__proto__")).toBe(true)
      expect(replay.exclusive?.__proto__).toBeNull()
      expect(log.claimExclusive(1, "__proto__", "worker")).toBe(true)
      expect(log.claimExclusive(1, "__proto__", "different-worker")).toBe(false)
    } finally {
      log.close()
    }
  })
}
