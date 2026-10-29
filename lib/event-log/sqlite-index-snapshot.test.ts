import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"

type Event = { left: string; right: string }

for (const operation of ["insert", "insertMany", "write"] as const) {
  test(`${operation} keeps index values aligned after the caller reorders its index array`, () => {
    const indexes: ["left", "right"] = ["left", "right"]
    const log = new SqliteEventLog<Event, typeof indexes>({
      path: ":memory:",
      indexes,
      extractIndexes: (event) => event,
    })
    try {
      indexes.reverse()
      const input = { ts: 0, event: { left: "first", right: "second" } }
      const result =
        operation === "insert"
          ? log.insert(input)
          : operation === "insertMany"
            ? log.insertMany([input])
            : log.write({ seq: 1, ...input })
      expect(result).not.toBeInstanceOf(Error)
      expect(
        log.query({ where: { left: "first", right: "second" } }).map((row) => row.event),
      ).toEqual([input.event])
      expect(log.query({ wherePrefix: { left: "fir" } })).toHaveLength(1)
      expect(log.query({ whereIn: { right: ["second"] } })).toHaveLength(1)
    } finally {
      log.close()
    }
  })
}

test("clearing the caller's index array cannot remove stored query filters", () => {
  const indexes: ["left", "right"] = ["left", "right"]
  const log = new SqliteEventLog<Event, typeof indexes>({
    path: ":memory:",
    indexes,
    extractIndexes: (event) => event,
  })
  try {
    log.insertMany([
      { ts: 0, event: { left: "one", right: "a" } },
      { ts: 0, event: { left: "two", right: "b" } },
    ])
    indexes.splice(0)
    expect(log.query({ where: { left: "one" } }).map((row) => row.event.left)).toEqual(["one"])
    expect(log.query({ wherePrefix: { right: "b" } }).map((row) => row.event.left)).toEqual(["two"])
    expect(log.query({ whereIn: { left: ["missing"] } })).toEqual([])
  } finally {
    log.close()
  }
})

test("invalid index names leave no directory behind", () => {
  const root = mkdtempSync(join(tmpdir(), "funnel-invalid-index-"))
  const directory = join(root, "nested")
  try {
    expect(
      () =>
        new SqliteEventLog<string, ["bad name"]>({
          path: join(directory, "events.db"),
          indexes: ["bad name"],
          extractIndexes: () => ({ "bad name": null }),
        }),
    ).toThrow("invalid index column name")
    expect(existsSync(directory)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
