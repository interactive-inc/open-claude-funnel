import { expect, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"

test("clear retains byte-check progress from writes made by its maintenance observer", () => {
  let written = false
  const log: SqliteEventLog<string> = new SqliteEventLog<string>({
    path: ":memory:",
    maxBytes: 1,
    targetBytes: 0,
    onMaintenanceError() {
      if (written) return
      written = true
      expect(
        log.insertMany(Array.from({ length: 499 }, () => ({ ts: 0, event: "observer" }))),
      ).not.toBeInstanceOf(Error)
    },
  })
  const original = Database.prototype.run
  const run = spyOn(Database.prototype, "run").mockImplementation(function (
    this: Database,
    sql,
    ...params
  ) {
    if (sql === "VACUUM") throw new Error("vacuum unavailable")
    return original.call(this, sql, ...params)
  })
  try {
    log.clear()
    expect(written).toBe(true)
    expect(log.query()).toHaveLength(499)
    expect(log.insert({ ts: 1, event: "later" })).toMatchObject({ seq: 500 })
    expect(log.query()).toHaveLength(0)
  } finally {
    run.mockRestore()
    log.close()
  }
})

for (const batches of [[500], [250, 250], [100, 400], [1001]]) {
  test(`byte retention counts inserted rows across batches ${batches.join("+")}`, () => {
    const log = new SqliteEventLog<string>({ path: ":memory:", maxBytes: 1, targetBytes: 0 })
    let total = 0
    try {
      for (const count of batches) {
        const result = log.insertMany(
          Array.from({ length: count }, () => ({ ts: 0, event: "input" })),
        )
        expect(result).not.toBeInstanceOf(Error)
        expect(result).toHaveLength(count)
        total += count
      }
      expect(log.query()).toHaveLength(0)
      expect(log.getMaxSeq()).toBe(total)
      expect(log.insert({ ts: 1, event: "later" })).toMatchObject({ seq: total + 1 })
      expect(log.query().map((row) => row.event)).toEqual(["later"])
    } finally {
      log.close()
    }
  })
}

for (const method of ["insert", "batch", "write"] as const) {
  test(`failed ${method} byte retention preserves its check boundary for retry`, () => {
    const root = mkdtempSync(join(tmpdir(), "funnel-byte-retention-retry-"))
    const path = join(root, "events.db")
    try {
      const log = new SqliteEventLog<string>({ path, maxBytes: 1, targetBytes: 0 })
      try {
        for (let index = 0; index < 499; index++)
          expect(log.insert({ ts: 0, event: "retained" })).not.toBeInstanceOf(Error)
        const control = new Database(path)
        try {
          control.run(
            "CREATE TRIGGER block_retention BEFORE DELETE ON logs BEGIN SELECT RAISE(ABORT, 'retention blocked'); END",
          )
          const insert = () =>
            method === "insert"
              ? log.insert({ ts: 1, event: "new" })
              : method === "batch"
                ? log.insertMany([{ ts: 1, event: "new" }])
                : log.write({ seq: 500, ts: 1, event: "new" })
          expect(insert()).toBeInstanceOf(Error)
          expect(log.getMaxSeq()).toBe(499)
          expect(log.query()).toHaveLength(499)
          control.run("DROP TRIGGER block_retention")
          expect(insert()).not.toBeInstanceOf(Error)
          expect(log.getMaxSeq()).toBe(500)
          expect(log.query()).toHaveLength(0)
        } finally {
          control.close()
        }
      } finally {
        log.close()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}
