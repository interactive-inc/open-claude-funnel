import { expect, test } from "bun:test"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

for (const storage of ["memory", "sqlite"] as const) {
  const create = () =>
    storage === "memory"
      ? new MemoryFunnelEventLog()
      : new SqliteFunnelEventLog({ path: ":memory:" })

  test(`${storage} invalid claims cannot consume an unassigned event`, () => {
    const log = create()
    try {
      log.record({
        offset: 1,
        content: "offline",
        channelId: null,
        connectorId: null,
        meta: null,
        exclusive: { ops: null },
      })
      expect(log.claimExclusive(1, "ops", "")).toBe(false)
      for (const offset of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        expect(log.claimExclusive(offset, "ops", "worker")).toBe(false)
      expect(log.claimExclusive(1, "", "worker")).toBe(false)
      expect(log.claimExclusive(1, null as never, "worker")).toBe(false)
      expect(log.claimExclusive(1, "ops", 42 as never)).toBe(false)
      expect(log.claimExclusive(1, "ops", "worker")).toBe(true)
      expect(log.claimExclusive(1, "ops", "worker")).toBe(true)
      expect(log.claimExclusive(1, "ops", "other-worker")).toBe(false)
    } finally {
      log.close()
    }
  })

  test(`${storage} scoped events cannot be claimed through another channel`, () => {
    const log = create()
    try {
      log.record({
        offset: 1,
        content: "private",
        channelId: "private",
        connectorId: null,
        meta: null,
        exclusive: { private: null, other: null },
      })
      expect(log.claimExclusive(1, "other", "worker")).toBe(false)
      expect(log.claimExclusive(1, "private", "owner")).toBe(true)
    } finally {
      log.close()
    }
  })

  test(`${storage} global events keep independent assignments for each declared channel`, () => {
    const log = create()
    try {
      log.record({
        offset: 1,
        content: "global",
        channelId: null,
        connectorId: null,
        meta: null,
        exclusive: { first: null, second: null },
      })
      expect(log.claimExclusive(1, "first", "first-worker")).toBe(true)
      expect(log.claimExclusive(1, "second", "second-worker")).toBe(true)
      expect(log.claimExclusive(1, "first", "second-worker")).toBe(false)
      expect(log.claimExclusive(1, "second", "second-worker")).toBe(true)
    } finally {
      log.close()
    }
  })
}
