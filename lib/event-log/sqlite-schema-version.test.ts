import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"

for (const version of [4, 99, -1]) {
  test(`unsupported schema version ${version} is rejected before changing the database`, () => {
    const directory = mkdtempSync(join(tmpdir(), "funnel-schema-version-"))
    const path = join(directory, "events.db")
    try {
      const current = new SqliteEventLog<string>({ path })
      current.insert({ ts: 0, event: "original" })
      current.close()
      const seed = new Database(path)
      seed.run("PRAGMA journal_mode = DELETE")
      seed.run(`PRAGMA user_version = ${version}`)
      seed.close()
      expect(() => {
        new SqliteEventLog<string, ["custom_key"]>({
          path,
          indexes: ["custom_key"],
          extractIndexes: () => ({ custom_key: "value" }),
        }).close()
      }).toThrow("unsupported event log schema version")
      const inspect = new Database(path)
      try {
        expect(inspect.query("PRAGMA user_version").get()).toEqual({ user_version: version })
        expect(inspect.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" })
        const columns = inspect.query<{ name: string }, []>("PRAGMA table_info(logs)").all()
        expect(columns.map((column) => column.name)).not.toContain("custom_key")
        expect(inspect.query("SELECT seq, ts, event FROM logs").all()).toEqual([
          { seq: 1, ts: 0, event: '"original"' },
        ])
        // A repair tool can immediately acquire exclusive access after the rejection.
        expect(() => inspect.run("BEGIN EXCLUSIVE")).not.toThrow()
        inspect.run("ROLLBACK")
      } finally {
        inspect.close()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
