import { expect, test } from "bun:test"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"

for (const nested of ["insert", "batch", "write"] as const) {
  test(`nested ${nested} cannot acknowledge data that an outer rollback removes`, () => {
    const log = new SqliteEventLog<unknown>({ path: ":memory:" })
    const failure = new Error("outer serialization failed")
    let outcome: unknown
    let nestedReads = 0
    const input = {
      seq: 10,
      get ts() {
        nestedReads++
        return 1
      },
      get event() {
        nestedReads++
        return "nested"
      },
    }
    try {
      const result = log.insertMany([
        { ts: 0, event: "outer" },
        {
          ts: 1,
          event: {
            toJSON() {
              outcome =
                nested === "insert"
                  ? log.insert(input)
                  : nested === "batch"
                    ? log.insertMany([input])
                    : log.write(input)
              throw failure
            },
          },
        },
      ])
      expect(result).toBe(failure)
      expect(outcome).toBeInstanceOf(Error)
      expect((outcome as Error).message).toBe("event log write is already in progress")
      expect(nestedReads).toBe(0)
      expect(log.query()).toEqual([])
      expect(log.getMaxSeq()).toBe(0)
      expect(log.insert({ ts: 2, event: "retry" })).toEqual({ seq: 1, ts: 2, event: "retry" })
    } finally {
      log.close()
    }
  })
}

for (const operation of ["clear", "close"] as const) {
  test(`${operation} cannot invalidate an active retention transaction`, () => {
    let reenter = false
    const log = new SqliteEventLog<string>({
      path: ":memory:",
      maxAgeMs: 1,
      now() {
        if (reenter) {
          reenter = false
          log[operation]()
        }
        return 0
      },
    })
    try {
      log.insert({ ts: 0, event: "original" })
      reenter = true
      const result = log.insert({ ts: 0, event: "outer" })
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toBe("event log write is already in progress")
      expect(log.getMaxSeq()).toBe(1)
      expect(log.query()).toEqual([{ seq: 1, ts: 0, event: "original" }])
      expect(log.insert({ ts: 0, event: "retry" })).toEqual({ seq: 2, ts: 0, event: "retry" })
    } finally {
      log.close()
    }
  })
}
