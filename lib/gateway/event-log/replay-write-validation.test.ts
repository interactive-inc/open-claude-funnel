import { expect, test } from "bun:test"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import type { FunnelEventRecord } from "@/gateway/event-log/event-log"

for (const type of ["memory", "sqlite"] as const) {
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
        { meta: { detail: 42 } },
        { meta: JSON.parse('{"__proto__":42}') },
        { exclusive: { ops: 42 } },
        { exclusive: JSON.parse('{"__proto__":42}') },
        { exclusive: null },
        { exclusive: false },
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
