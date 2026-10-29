import { expect, test } from "bun:test"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { Funnel } from "@/funnel"

const invalidTimes = [Infinity, -Infinity, 8_640_000_000_000_001, NaN]

for (const operation of ["insert", "insertMany", "write"] as const) {
  test(`${operation} rejects invalid timestamps without advancing or trimming the log`, () => {
    const log = new SqliteEventLog<string>({ path: ":memory:", maxRows: 1 })
    try {
      expect(log.insert({ ts: 0, event: "original" })).toMatchObject({ seq: 1 })
      for (const ts of invalidTimes) {
        const input = { ts, event: "invalid" }
        const result =
          operation === "insert"
            ? log.insert(input)
            : operation === "insertMany"
              ? log.insertMany([{ ts: 1, event: "valid" }, input])
              : log.write({ seq: 2, ...input })
        expect(result).toBeInstanceOf(RangeError)
        expect(log.query()).toEqual([{ seq: 1, ts: 0, event: "original" }])
        expect(log.getMaxSeq()).toBe(1)
      }
      expect(log.insert({ ts: 1, event: "retry" })).toMatchObject({ seq: 2 })
    } finally {
      log.close()
    }
  })

  test(`${operation} rolls back when the retention clock returns an invalid timestamp`, () => {
    let now = 0
    const log = new SqliteEventLog<string>({
      path: ":memory:",
      maxRows: 1,
      maxAgeMs: 1,
      now: () => now,
    })
    try {
      expect(log.insert({ ts: 0, event: "original" })).toMatchObject({ seq: 1 })
      for (const time of invalidTimes) {
        now = time
        const input = { ts: 1, event: "next" }
        const result =
          operation === "insert"
            ? log.insert(input)
            : operation === "insertMany"
              ? log.insertMany([input])
              : log.write({ seq: 2, ...input })
        expect(result).toBeInstanceOf(RangeError)
        expect(log.query()).toEqual([{ seq: 1, ts: 0, event: "original" }])
        expect(log.getMaxSeq()).toBe(1)
      }
      now = 1
      expect(log.insert({ ts: 1, event: "retry" })).toMatchObject({ seq: 2 })
    } finally {
      log.close()
    }
  })
}

test("SQLite accepts valid negative, fractional and boundary timestamps", () => {
  const log = new SqliteEventLog<string>({ path: ":memory:" })
  try {
    const timestamps = [-8_640_000_000_000_000, -0.5, 0, 0.5, 8_640_000_000_000_000]
    for (const ts of timestamps)
      expect(log.insert({ ts, event: "entry" })).not.toBeInstanceOf(Error)
    expect(log.query().map((record) => record.ts)).toEqual(timestamps)
  } finally {
    log.close()
  }
})

test("an invalid persistence clock cannot deliver an event or destroy existing replay", async () => {
  let now = 0
  const failures: Error[] = []
  const log = new SqliteFunnelEventLog({
    path: ":memory:",
    maxRows: 1,
    now: () => now,
    onError: (error) => {
      failures.push(error)
    },
  })
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
    token: "",
    eventLog: log,
  })
  const seen: string[] = []
  gateway.getBroadcaster().subscribe((event) => {
    seen.push(event.content)
  })
  try {
    gateway.emit({ channel: "ops", content: "original" })
    now = Infinity
    expect(() => gateway.emit({ channel: "ops", content: "invalid" })).toThrow(
      "time must be a valid timestamp",
    )
    expect(seen).toEqual(["original"])
    expect(log.loadSince(0).map((event) => event.content)).toEqual(["original"])
    expect(log.findMaxOffset()).toBe(1)
    expect(failures).toHaveLength(1)
    now = 1
    gateway.emit({ channel: "ops", content: "retry" })
    expect(seen).toEqual(["original", "retry"])
  } finally {
    await gateway.stop()
    log.close()
  }
})
