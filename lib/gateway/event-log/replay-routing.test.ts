import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

for (const storage of ["memory", "sqlite"] as const) {
  const create = () =>
    storage === "memory"
      ? new MemoryFunnelEventLog()
      : new SqliteFunnelEventLog({ path: ":memory:" })

  test(`${storage} replay derives routing metadata from stored identifiers`, () => {
    const log = create()
    try {
      log.record({
        offset: 1,
        content: "private history",
        channelId: "private",
        connectorId: "source",
        meta: null,
      })
      expect(log.loadSince(0)[0]?.meta).toEqual({ channelId: "private", connectorId: "source" })
      const broadcaster = new FunnelBroadcaster({ persistentReplay: log, replayBufferSize: 0 })
      broadcaster.seedLatestOffset(1)
      expect(
        broadcaster.replaySince(0, { channel: "other", connectors: [], connectorIds: ["source"] }),
      ).toEqual([])
      expect(
        broadcaster.replaySince(0, { channel: "private", connectors: [], connectorIds: ["other"] }),
      ).toEqual([])
      expect(
        broadcaster
          .replaySince(0, { channel: "private", connectors: [], connectorIds: ["source"] })
          .map((row) => row.content),
      ).toEqual(["private history"])
    } finally {
      log.close()
    }
  })

  test(`${storage} conflicting routing metadata fails without changing history`, () => {
    const log = create()
    try {
      const conflicts: Record<string, string>[] = [{ channelId: "other" }, { connectorId: "other" }]
      for (const meta of conflicts) {
        expect(() =>
          log.record({
            offset: 1,
            content: "conflicting",
            channelId: "private",
            connectorId: "source",
            meta,
          }),
        ).toThrow("replay routing metadata conflicts")
        expect(log.findMaxOffset()).toBe(0)
        expect(log.loadSince(0)).toEqual([])
      }
      log.record({
        offset: 1,
        content: "retry",
        channelId: "private",
        connectorId: "source",
        meta: { detail: "preserved" },
      })
      expect(log.loadSince(0)[0]?.meta).toEqual({
        channelId: "private",
        connectorId: "source",
        detail: "preserved",
      })
    } finally {
      log.close()
    }
  })

  test(`${storage} metadata cannot add a scoped identity to an unscoped record`, () => {
    const log = create()
    try {
      expect(() =>
        log.record({
          offset: 1,
          content: "conflicting",
          channelId: null,
          connectorId: null,
          meta: { channelId: "private" },
        }),
      ).toThrow("replay routing metadata conflicts")
      expect(log.findMaxOffset()).toBe(0)
    } finally {
      log.close()
    }
  })
}
