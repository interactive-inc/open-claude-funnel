import { expect, test } from "bun:test"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

const record = {
  eventId: "event",
  type: "source",
  connectorId: null,
  channelId: null,
  payload: "{}",
  outcome: "emitted",
  status: "connected" as const,
  detail: "",
}

for (const [write, read] of [
  ["recordRaw", "queryRaw"],
  ["recordProcessed", "queryProcessed"],
  ["recordConnection", "queryConnection"],
] as const) {
  test(`${write} rejects invalid clocks before storing or allocating a sequence`, () => {
    let now = 0
    const log = new MemoryConnectorDiagnosticLog(() => now)
    try {
      for (const invalid of [NaN, Infinity, -Infinity, 8640000000000001, -8640000000000001]) {
        now = invalid
        expect(() => log[write](record)).toThrow("time must be a valid timestamp")
        expect(log[read]({})).toEqual([])
      }
      now = 0
      log[write](record)
      expect(log[read]({}).map(({ seq, ts }) => ({ seq, ts }))).toEqual([{ seq: 1, ts: 0 }])
    } finally {
      log.close()
    }
  })

  test(`${write} preserves valid zero, negative and fractional timestamps`, () => {
    let now = 0
    const log = new MemoryConnectorDiagnosticLog(() => now)
    const timestamps = [0, -1000, 0.5]
    try {
      for (const value of timestamps) {
        now = value
        log[write](record)
      }
      expect(log[read]({}).map((row) => row.ts)).toEqual(timestamps)
    } finally {
      log.close()
    }
  })
}
