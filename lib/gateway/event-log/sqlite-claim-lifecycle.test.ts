import { Database } from "bun:sqlite"
import { expect, test, spyOn } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

const record = (offset: number, content = "input") => ({
  offset,
  content,
  channelId: "ops",
  connectorId: null,
  meta: null,
  exclusive: { ops: null },
})

for (const storage of ["memory", "file"] as const) {
  test(`${storage} age retention cannot transfer an old claim to a reused offset`, () => {
    const directory = mkdtempSync(join(tmpdir(), "funnel-claims-"))
    const path = storage === "memory" ? ":memory:" : join(directory, "events.db")
    let now = 0
    const log = new SqliteFunnelEventLog({ path, maxAgeMs: 50, now: () => now })
    try {
      log.record(record(2, "old"))
      expect(log.claimExclusive(2, "ops", "old-worker")).toBe(true)
      now = 100
      // Offsets may arrive out of order; expiry can leave a hole above the oldest offset.
      log.record(record(1, "anchor"))
      expect(log.loadSince(0).map((event) => event.offset)).toEqual([1])
      expect(log.claimExclusive(2, "ops", "old-worker")).toBe(false)
      log.record(record(2, "new"))
      expect(log.claimExclusive(2, "ops", "new-worker")).toBe(true)
      expect(log.claimExclusive(2, "ops", "old-worker")).toBe(false)
      expect(log.findMaxOffset()).toBe(2)
      if (storage === "file") {
        log.close()
        const reopened = new SqliteFunnelEventLog({ path })
        try {
          expect(reopened.claimExclusive(2, "ops", "new-worker")).toBe(true)
          expect(reopened.claimExclusive(2, "ops", "old-worker")).toBe(false)
        } finally {
          reopened.close()
        }
      }
    } finally {
      log.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const operation of ["retention", "clear"] as const) {
  test(`${operation} rolls back replay and claims together when claim cleanup fails`, () => {
    const directory = mkdtempSync(join(tmpdir(), "funnel-claims-"))
    const path = join(directory, "events.db")
    let now = 0
    const log = new SqliteFunnelEventLog({ path, maxAgeMs: 50, now: () => now })
    const database = new Database(path)
    try {
      log.record(record(1, "original"))
      expect(log.claimExclusive(1, "ops", "original-worker")).toBe(true)
      database.run(`CREATE TRIGGER reject_claim_delete BEFORE DELETE ON funnel_exclusive_claims
        BEGIN SELECT RAISE(ABORT, 'claim cleanup unavailable'); END`)
      now = 100
      expect(() => (operation === "clear" ? log.clear() : log.record(record(2)))).toThrow(
        "claim cleanup unavailable",
      )
      expect(log.loadSince(0).map((event) => event.content)).toEqual(["original"])
      expect(log.findMaxOffset()).toBe(1)
      expect(log.claimExclusive(1, "ops", "original-worker")).toBe(true)
      expect(log.claimExclusive(1, "ops", "other-worker")).toBe(false)
      database.run("DROP TRIGGER reject_claim_delete")
      if (operation === "clear") log.clear()
      log.record(record(2, "retry"))
      expect(log.loadSince(0).map((event) => event.content)).toEqual(["retry"])
      expect(log.claimExclusive(2, "ops", "new-worker")).toBe(true)
    } finally {
      database.close()
      log.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test("legacy orphan claims are removed only when a replacement record commits", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-claims-"))
  const path = join(directory, "events.db")
  const log = new SqliteFunnelEventLog({ path })
  const database = new Database(path)
  try {
    database.run("INSERT INTO funnel_exclusive_claims VALUES (3, 'ops', 'old-worker')")
    database.run(`CREATE TRIGGER reject_sequence_update BEFORE UPDATE ON log_sequence
      BEGIN SELECT RAISE(ABORT, 'sequence update unavailable'); END`)
    expect(() => log.record(record(3, "failed"))).toThrow("sequence update unavailable")
    expect(
      database.query("SELECT subscriber_id FROM funnel_exclusive_claims WHERE offset = 3").get(),
    ).toEqual({ subscriber_id: "old-worker" })
    expect(log.loadSince(0)).toEqual([])
    database.run("DROP TRIGGER reject_sequence_update")
    log.record(record(3, "new"))
    expect(log.claimExclusive(3, "ops", "new-worker")).toBe(true)
    expect(() => log.record(record(3, "duplicate"))).toThrow()
    expect(log.claimExclusive(3, "ops", "new-worker")).toBe(true)
    expect(log.claimExclusive(3, "ops", "old-worker")).toBe(false)
    expect(log.loadSince(0).map((event) => event.content)).toEqual(["new"])
  } finally {
    database.close()
    log.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a retention callback cannot acknowledge a claim inside a transaction that rolls back", () => {
  let armed = false
  let calls = 0
  let attempt: unknown
  const log = new SqliteFunnelEventLog({
    path: ":memory:",
    maxAgeMs: 50,
    now() {
      if (armed && ++calls === 2) {
        try {
          attempt = log.claimExclusive(1, "ops", "nested-worker")
        } catch (error) {
          attempt = error
        }
        throw new Error("retention failed")
      }
      return 0
    },
  })
  try {
    log.record(record(1))
    armed = true
    expect(() => log.record(record(2))).toThrow("retention failed")
    expect(attempt).toBeInstanceOf(Error)
    expect((attempt as Error).message).toBe("event log write is already in progress")
    armed = false
    expect(log.claimExclusive(1, "ops", "next-worker")).toBe(true)
    expect(log.claimExclusive(1, "ops", "nested-worker")).toBe(false)
    expect(log.findMaxOffset()).toBe(1)
  } finally {
    log.close()
  }
})

test("clear preserves a new claim created by a post-commit maintenance observer", () => {
  const log = new SqliteFunnelEventLog({
    path: ":memory:",
    onError(_error, context) {
      if (context?.op === "compact") {
        log.record(record(2, "new"))
        expect(log.claimExclusive(2, "ops", "new-worker")).toBe(true)
      }
    },
  })
  const originalRun = Database.prototype.run
  const run = spyOn(Database.prototype, "run").mockImplementation(function (
    this: Database,
    sql,
    ...params
  ) {
    if (sql === "VACUUM") throw new Error("compaction unavailable")
    return originalRun.call(this, sql, ...params)
  })
  try {
    log.record(record(1, "original"))
    expect(log.claimExclusive(1, "ops", "old-worker")).toBe(true)
    log.clear()
    expect(log.loadSince(0).map((event) => event.content)).toEqual(["new"])
    expect(log.claimExclusive(2, "ops", "other-worker")).toBe(false)
    expect(log.claimExclusive(2, "ops", "new-worker")).toBe(true)
  } finally {
    run.mockRestore()
    log.close()
  }
})
