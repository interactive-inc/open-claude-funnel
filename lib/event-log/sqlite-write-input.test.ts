import { expect, test } from "bun:test"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"

test("an invalid SQLite sequence is rejected before reading the timestamp or event", () => {
  const log = new SqliteEventLog<string>({ path: ":memory:" })
  let reads = 0
  try {
    const result = log.write({
      seq: 0,
      get ts() {
        reads++
        return 0
      },
      get event() {
        reads++
        return "input"
      },
    })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe("event log sequence must be a positive safe integer")
    expect(reads).toBe(0)
    expect(log.getMaxSeq()).toBe(0)
    expect(log.query()).toEqual([])
  } finally {
    log.close()
  }
})

test("SQLite writes use the same sequence for validation, storage and the high watermark", () => {
  const log = new SqliteEventLog<string>({ path: ":memory:" })
  let reads = 0
  try {
    expect(
      log.write({
        get seq() {
          return ++reads <= 2 ? 1 : -1
        },
        ts: 0,
        event: "input",
      }),
    ).toBeUndefined()
    expect(log.query()).toEqual([{ seq: 1, ts: 0, event: "input" }])
    expect(log.getMaxSeq()).toBe(1)
    expect(reads).toBe(1)
  } finally {
    log.close()
  }
})

for (const batch of [false, true]) {
  test(`SQLite insertion returns the timestamp and event it captured for storage (batch=${batch})`, () => {
    const log = new SqliteEventLog<{ type: string }>({ path: ":memory:" })
    let timeReads = 0
    let eventReads = 0
    const original = { type: "original" }
    const input = {
      get ts() {
        return ++timeReads === 1 ? 0 : NaN
      },
      get event() {
        return ++eventReads === 1 ? original : { type: "replacement" }
      },
    }
    try {
      const result = batch ? log.insertMany([input]) : log.insert(input)
      if (result instanceof Error) throw result
      const records = Array.isArray(result) ? result : [result]
      expect(records).toEqual([{ seq: 1, ts: 0, event: original }])
      expect(log.query()).toEqual(records)
      expect(timeReads).toBe(1)
      expect(eventReads).toBe(1)
    } finally {
      log.close()
    }
  })
}
