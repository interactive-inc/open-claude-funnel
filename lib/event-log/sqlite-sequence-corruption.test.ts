import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { Funnel } from "@/funnel"

for (const corruption of [
  "missing",
  "stale",
  "negative",
  "fractional",
  "unsafe",
  "text",
] as const) {
  test(`sequence corruption (${corruption}) cannot seed replay or commit more events`, () => {
    const directory = mkdtempSync(join(tmpdir(), "funnel-sequence-corruption-"))
    const path = join(directory, "events.db")
    const log = new SqliteEventLog<string>({ path })
    const database = new Database(path)
    try {
      expect(log.write({ seq: 3, ts: 1, event: "original" })).toBeUndefined()
      if (corruption === "missing") database.run("DELETE FROM log_sequence")
      else {
        const value = {
          stale: 0,
          negative: -2,
          fractional: 1.5,
          unsafe: Number.MAX_SAFE_INTEGER + 1,
          text: "invalid",
        }[corruption]
        database.run("UPDATE log_sequence SET seq = ? WHERE id = 1", [value])
      }
      const damaged = database.query("SELECT seq FROM log_sequence").all()
      expect(() => log.getMaxSeq()).toThrow("event log sequence state is invalid")
      expect(log.insert({ ts: 2, event: "new" })).toBeInstanceOf(Error)
      expect(log.insertMany([{ ts: 2, event: "batch" }])).toBeInstanceOf(Error)
      expect(log.write({ seq: 10, ts: 2, event: "relay" })).toBeInstanceOf(Error)
      expect(database.query("SELECT seq FROM log_sequence").all()).toEqual(damaged)
      expect(log.query()).toEqual([{ seq: 3, ts: 1, event: "original" }])

      database.run("INSERT OR REPLACE INTO log_sequence (id, seq) VALUES (1, 3)")
      expect(log.getMaxSeq()).toBe(3)
      expect(log.insert({ ts: 2, event: "retry" })).toEqual({ seq: 4, ts: 2, event: "retry" })
      expect(log.getMaxSeq()).toBe(4)
    } finally {
      database.close()
      log.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test("sequence damage during a transaction rolls back every write path", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-sequence-trigger-"))
  const path = join(directory, "events.db")
  const log = new SqliteEventLog<string>({ path })
  const database = new Database(path)
  try {
    log.write({ seq: 3, ts: 1, event: "original" })
    database.run(`CREATE TRIGGER damage_sequence AFTER INSERT ON logs
      BEGIN DELETE FROM log_sequence; END`)
    expect(log.insert({ ts: 2, event: "new" })).toBeInstanceOf(Error)
    expect(
      log.insertMany([
        { ts: 2, event: "batch" },
        { ts: 3, event: "later" },
      ]),
    ).toBeInstanceOf(Error)
    expect(log.write({ seq: 10, ts: 2, event: "relay" })).toBeInstanceOf(Error)
    expect(log.getMaxSeq()).toBe(3)
    expect(log.query()).toEqual([{ seq: 3, ts: 1, event: "original" }])
    database.run("DROP TRIGGER damage_sequence")
    expect(log.insert({ ts: 2, event: "retry" })).toEqual({ seq: 4, ts: 2, event: "retry" })
  } finally {
    database.close()
    log.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("gateway creation rejects missing durable offsets and resumes after host repair", async () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-replay-sequence-"))
  const path = join(directory, "events.db")
  const log = new SqliteFunnelEventLog({ path })
  const database = new Database(path)
  try {
    log.record({ offset: 3, content: "original", channelId: null, connectorId: null, meta: null })
    database.run("DELETE FROM log_sequence")
    const funnel = new Funnel({ channels: [{ name: "ops" }] })
    expect(() => funnel.gatewayModule({ token: "", eventLog: log })).toThrow(
      "event log sequence state is invalid",
    )
    database.run("INSERT INTO log_sequence (id, seq) VALUES (1, 3)")
    const gateway = funnel.gatewayModule({ token: "", eventLog: log })
    try {
      expect(gateway.emit({ channel: "ops", content: "next" }).offset).toBe(4)
      expect(log.findMaxOffset()).toBe(4)
    } finally {
      await gateway.stop()
    }
  } finally {
    database.close()
    log.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
