import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { FunnelBroadcaster } from "@/gateway/broadcaster"

test("malformed stored replay data cannot be returned or claimed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-replay-data-"))
  const path = join(directory, "events.db")
  const log = new SqliteFunnelEventLog({ path })
  const db = new Database(path)
  try {
    log.record({
      offset: 1,
      content: "history",
      channelId: "ops",
      connectorId: "source",
      meta: { channelId: "ops" },
      exclusive: { ops: null },
    })
    const row = db.query<{ event: string }, []>("SELECT event FROM logs WHERE seq = 1").get()!
    const original = JSON.parse(row.event)
    for (const invalid of [
      { content: undefined },
      { meta: "invalid" },
      { meta: { channelId: 42 } },
      { exclusive: { ops: 42 } },
      { channel_id: 42 },
      { type: null },
      { meta: JSON.parse('{"__proto__":42}') },
      { exclusive: JSON.parse('{"__proto__":42}') },
    ]) {
      db.run("UPDATE logs SET event = ? WHERE seq = 1", [
        JSON.stringify({ ...original, ...invalid }),
      ])
      expect(() => log.loadSince(0)).toThrow("replay event data is invalid")
      expect(() => log.loadForChannel({ channelId: "ops" })).toThrow("replay event data is invalid")
      expect(() => log.claimExclusive(1, "ops", "worker")).toThrow("replay event data is invalid")
      const broadcaster = new FunnelBroadcaster({ persistentReplay: log, replayBufferSize: 0 })
      broadcaster.seedLatestOffset(1)
      const stream = broadcaster.events({ channel: "ops", connectors: [] }, { since: 0 })
      await expect(stream.next()).rejects.toThrow("replay event data is invalid")
      expect(broadcaster.getMetrics().subscribers).toBe(0)
    }
    expect(
      db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM funnel_exclusive_claims").get()
        ?.count,
    ).toBe(0)
    db.run("UPDATE logs SET event = ? WHERE seq = 1", [row.event])
    expect(log.loadSince(0)[0]?.content).toBe("history")
    expect(log.claimExclusive(1, "ops", "worker")).toBe(true)
  } finally {
    db.close()
    log.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("valid metadata dictionary keys survive SQLite validation", () => {
  const log = new SqliteFunnelEventLog({ path: ":memory:" })
  try {
    log.record({
      offset: 1,
      content: "history",
      channelId: null,
      connectorId: null,
      meta: JSON.parse('{"__proto__":"literal-value"}'),
    })
    const row = log.loadSince(0)[0]!
    expect(Object.hasOwn(row.meta ?? {}, "__proto__")).toBe(true)
    expect(row.meta?.__proto__).toBe("literal-value")
  } finally {
    log.close()
  }
})

test("invalid replay writes are reported without advancing the durable offset", () => {
  const errors: Error[] = []
  const log = new SqliteFunnelEventLog({
    path: ":memory:",
    onError: (error) => {
      errors.push(error)
    },
  })
  try {
    expect(() =>
      log.record({
        offset: 1,
        content: 42 as never,
        channelId: null,
        connectorId: null,
        meta: null,
      }),
    ).toThrow("replay event data is invalid")
    expect(errors).toHaveLength(1)
    expect(log.findMaxOffset()).toBe(0)
    expect(log.loadSince(0)).toEqual([])
    log.record({ offset: 1, content: "retry", channelId: null, connectorId: null, meta: null })
    expect(log.loadSince(0)[0]?.content).toBe("retry")
  } finally {
    log.close()
  }
})
