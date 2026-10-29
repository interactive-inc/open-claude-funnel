import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog, type SqliteEventLogProps } from "@/event-log/sqlite-event-log"

test("SQLite directory creation and open use the same captured path", () => {
  const root = mkdtempSync(join(tmpdir(), "funnel-store-options-"))
  const path = join(root, "nested", "events.db")
  const other = join(root, "other.db")
  let reads = 0
  try {
    const seed = new SqliteEventLog<string>({ path: other })
    try {
      seed.insert({ ts: 0, event: "unrelated" })
    } finally {
      seed.close()
    }
    const log = new SqliteEventLog<string>({
      get path() {
        return ++reads === 1 ? path : other
      },
    })
    try {
      expect(log.insert({ ts: 0, event: "input" })).not.toBeInstanceOf(Error)
    } finally {
      log.close()
    }
    expect(reads).toBe(1)
    expect(existsSync(path)).toBe(true)
    const selected = new SqliteEventLog<string>({ path })
    const untouched = new SqliteEventLog<string>({ path: other })
    try {
      expect(selected.query().map((row) => row.event)).toEqual(["input"])
      expect(untouched.query().map((row) => row.event)).toEqual(["unrelated"])
    } finally {
      selected.close()
      untouched.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

for (const field of ["maxRows", "maxAgeMs", "maxBytes", "targetBytes"] as const) {
  test(`SQLite captures the zero ${field} retention setting once`, () => {
    let reads = 0
    const options: SqliteEventLogProps<string, readonly []> = {
      path: ":memory:",
      now: () => 100,
      ...(field === "targetBytes" ? { maxBytes: 16_000 } : {}),
    }
    Object.defineProperty(options, field, {
      get() {
        return ++reads === 1 ? 0 : field === "targetBytes" ? 16_000 : 1_000_000
      },
    })
    const log = new SqliteEventLog<string>(options)
    try {
      const count = field === "maxBytes" || field === "targetBytes" ? 500 : 1
      for (let index = 0; index < count; index++) {
        expect(log.insert({ ts: 0, event: "x".repeat(100) })).not.toBeInstanceOf(Error)
      }
      expect(log.query()).toHaveLength(0)
      expect(log.getMaxSeq()).toBe(count)
      expect(reads).toBe(1)
    } finally {
      log.close()
    }
  })

  test(`an invalid first ${field} value is rejected before opening SQLite`, () => {
    const root = mkdtempSync(join(tmpdir(), "funnel-invalid-store-option-"))
    const directory = join(root, "nested")
    let reads = 0
    let log: SqliteEventLog<string> | undefined
    const options: SqliteEventLogProps<string, readonly []> = {
      path: join(directory, "events.db"),
      ...(field === "targetBytes" ? { maxBytes: 10 } : {}),
    }
    Object.defineProperty(options, field, {
      get() {
        return ++reads === 1 ? NaN : 0
      },
    })
    try {
      expect(() => {
        log = new SqliteEventLog<string>(options)
      }).toThrow(`${field} must be a non-negative`)
      expect(reads).toBe(1)
      expect(existsSync(directory)).toBe(false)
    } finally {
      log?.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
}
