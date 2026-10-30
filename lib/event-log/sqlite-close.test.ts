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
