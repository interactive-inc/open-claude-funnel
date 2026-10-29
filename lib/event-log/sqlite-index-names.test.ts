import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { Database } from "bun:sqlite"

for (const column of ["group", "select", "order"]) {
  test(`SQLite keyword ${column} works as an indexed column across writes and filters`, () => {
    const log = new SqliteEventLog<{ value: string | null }, readonly string[]>({
      path: ":memory:",
      indexes: [column],
      extractIndexes: (event) => ({ [column]: event.value }),
    })
    try {
      expect(log.insert({ ts: 0, event: { value: "alpha" } })).not.toBeInstanceOf(Error)
      expect(
        log.insertMany([
          { ts: 0, event: { value: "beta" } },
          { ts: 0, event: { value: null } },
        ]),
      ).not.toBeInstanceOf(Error)
      expect(log.write({ seq: 4, ts: 0, event: { value: "gamma" } })).toBeUndefined()
      expect(log.query({ where: { [column]: "alpha" } }).map((row) => row.seq)).toEqual([1])
      expect(log.query({ where: { [column]: null } }).map((row) => row.seq)).toEqual([3])
      expect(log.query({ wherePrefix: { [column]: "al" } }).map((row) => row.seq)).toEqual([1])
      expect(log.query({ whereIn: { [column]: ["alpha", null] } }).map((row) => row.seq)).toEqual([
        1, 3,
      ])
    } finally {
      log.close()
    }
  })
}

for (const columns of [["key", "key"], ["key", "KEY"], ["SEQ"], ["Ts"], ["TYPE"], ["eVeNt"]]) {
  test(`colliding columns ${columns.join("/")} are rejected before creating a database`, () => {
    const root = mkdtempSync(join(tmpdir(), "funnel-column-names-"))
    const directory = join(root, "nested")
    try {
      expect(
        () =>
          new SqliteEventLog<string, readonly string[]>({
            path: join(directory, "events.db"),
            indexes: columns,
            extractIndexes: () => ({}),
          }),
      ).toThrow(/invalid index column|duplicate index column|reserved index column/)
      expect(existsSync(directory)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test("reopening a keyword index preserves existing rows", () => {
  const root = mkdtempSync(join(tmpdir(), "funnel-column-case-"))
  const path = join(root, "events.db")
  try {
    const original = new SqliteEventLog<string, ["group"]>({
      path,
      indexes: ["group"],
      extractIndexes: (event) => ({ group: event }),
    })
    try {
      expect(original.insert({ ts: 0, event: "original" })).not.toBeInstanceOf(Error)
    } finally {
      original.close()
    }
    const reopened = new SqliteEventLog<string, ["group"]>({
      path,
      indexes: ["group"],
      extractIndexes: (event) => ({ group: event }),
    })
    try {
      expect(reopened.query({ where: { group: "original" } }).map((row) => row.event)).toEqual([
        "original",
      ])
      expect(reopened.insert({ ts: 0, event: "new" })).not.toBeInstanceOf(Error)
      expect(reopened.query({ where: { group: "new" } }).map((row) => row.event)).toEqual(["new"])
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("duplicate index definitions cannot partially modify an existing database", () => {
  const root = mkdtempSync(join(tmpdir(), "funnel-duplicate-columns-"))
  const path = join(root, "events.db")
  try {
    const original = new SqliteEventLog<string>({ path })
    try {
      expect(original.insert({ ts: 0, event: "original" })).not.toBeInstanceOf(Error)
    } finally {
      original.close()
    }
    expect(
      () =>
        new SqliteEventLog<string, ["scope", "scope"]>({
          path,
          indexes: ["scope", "scope"],
          extractIndexes: (event) => ({ scope: event }),
        }),
    ).toThrow("duplicate index column name")
    const inspect = new Database(path, { readonly: true })
    try {
      expect(
        inspect
          .query<{ name: string }, []>("PRAGMA table_info(logs)")
          .all()
          .map((row) => row.name),
      ).not.toContain("scope")
      expect(inspect.query<{ event: string }, []>("SELECT event FROM logs").all()).toEqual([
        { event: JSON.stringify("original") },
      ])
    } finally {
      inspect.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
