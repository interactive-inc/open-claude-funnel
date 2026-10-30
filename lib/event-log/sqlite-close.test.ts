import { Database } from "bun:sqlite"
import { expect, test, spyOn } from "bun:test"
import { mkdtempSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"

test("close finalizes statements and releases database files without waiting for GC", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel close "))
  const path = join(directory, "events.db")
  const originalClose = Database.prototype.close
  const close = spyOn(Database.prototype, "close").mockImplementation(function (this: Database) {
    // sqlite3_close (rather than close_v2) fails if a statement still owns the connection.
    return originalClose.call(this, true)
  })
  try {
    const log = new SqliteEventLog<{ type: string; key: string }, readonly ["key"]>({
      path,
      indexes: ["key"],
      extractIndexes: (event) => ({ key: event.key }),
      maxBytes: 1_000_000,
    })
    // Exercise cached writers, dynamic queries, migration/schema reads and retention PRAGMAs.
    expect(
      log.insertMany(
        Array.from({ length: 101 }, (_, index) => ({
          ts: index,
          event: { type: "test", key: String(index) },
        })),
      ),
    ).not.toBeInstanceOf(Error)
    for (const index of Array.from({ length: 101 }, (_, index) => index)) {
      expect(
        log.insert({ ts: index, event: { type: "test", key: String(index) } }),
      ).not.toBeInstanceOf(Error)
    }
    expect(log.query({ where: { key: "1" } })).toHaveLength(2)
    for (const size of Array.from({ length: 150 }, (_, index) => index + 1)) {
      expect(log.query({ whereIn: { key: Array.from({ length: size }, () => "1") } })).toHaveLength(
        2,
      )
    }
    expect(
      log.insert({ ts: 200, event: { type: "test", key: "after queries" } }),
    ).not.toBeInstanceOf(Error)
    expect(log.getSchemaVersion()).toBeGreaterThan(0)
    expect(() => log.close()).not.toThrow()
    expect(() => log.close()).not.toThrow()
    // Windows refuses these operations while SQLite retains the file handles.
    renameSync(path, `${path}.moved`)
    rmSync(`${path}.moved`)
  } finally {
    close.mockRestore()
    rmSync(directory, { recursive: true, force: true })
  }
}, 15_000)

test("a constructor failure after migration releases the database before retry", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel failed close "))
  const path = join(directory, "events.db")
  const failure = new Error("host clock configuration failed")
  try {
    expect(
      () =>
        new SqliteEventLog<string>({
          path,
          get now(): () => number {
            throw failure
          },
        }),
    ).toThrow(failure)
    const database = new Database(path)
    try {
      // Changing the journal mode requires every previous connection to be released.
      expect(database.query("PRAGMA journal_mode = DELETE").get()).toEqual({
        journal_mode: "delete",
      })
    } finally {
      database.close()
    }
    const retry = new SqliteEventLog<string>({ path })
    try {
      expect(retry.insert({ ts: 0, event: "retry" })).not.toBeInstanceOf(Error)
      expect(retry.query().map(({ event }) => event)).toEqual(["retry"])
    } finally {
      retry.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
