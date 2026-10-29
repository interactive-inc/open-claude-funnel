import { expect, test } from "bun:test"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

const invalidPositions = [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]

for (const field of ["limit", "sinceSeq", "seq"] as const) {
  test(`SQLite rejects invalid query ${field} instead of changing the requested range`, () => {
    const log = new SqliteEventLog<string>({ path: ":memory:" })
    try {
      log.insertMany([
        { ts: 0, event: "one" },
        { ts: 1, event: "two" },
      ])
      for (const value of invalidPositions)
        expect(() => log.query({ [field]: value })).toThrow(
          `${field} must be a non-negative safe integer`,
        )
      expect(log.query()).toHaveLength(2)
    } finally {
      log.close()
    }
  })
}

test("zero query bounds, exact sequence precedence and descending clipping remain supported", () => {
  const log = new SqliteEventLog<string>({ path: ":memory:" })
  try {
    log.insertMany([
      { ts: 0, event: "one" },
      { ts: 1, event: "two" },
      { ts: 2, event: "three" },
    ])
    expect(log.query({ limit: 0 })).toEqual([])
    expect(log.query({ seq: 0 })).toEqual([])
    expect(log.query({ sinceSeq: 0, limit: 1 }).map((row) => row.event)).toEqual(["one"])
    expect(log.query({ seq: 1, sinceSeq: NaN }).map((row) => row.event)).toEqual(["one"])
    expect(log.query({ order: "desc", limit: 2 }).map((row) => row.event)).toEqual(["two", "three"])
    expect(log.query({ sinceSeq: Number.MAX_SAFE_INTEGER })).toEqual([])
  } finally {
    log.close()
  }
})

test("SQLite replay adapters cannot turn negative page sizes into unbounded reads", () => {
  const log = new SqliteFunnelEventLog({ path: ":memory:" })
  try {
    log.record({ offset: 1, content: "entry", meta: null, channelId: "ops", connectorId: "source" })
    expect(() => log.loadSince(0, -1)).toThrow("limit must be a non-negative safe integer")
    expect(() => log.loadForChannel({ channelId: "ops", limit: -1 })).toThrow(
      "limit must be a non-negative safe integer",
    )
    expect(log.loadSince(0)).toHaveLength(1)
  } finally {
    log.close()
  }
})

test("SQLite diagnostic queries reject unbounded negative limits even for empty tables", () => {
  const log = new SqliteConnectorDiagnosticLog({
    rawPath: ":memory:",
    processedPath: ":memory:",
    connectionPath: ":memory:",
  })
  try {
    expect(() => log.queryRaw({ limit: -1 })).toThrow("limit must be a non-negative safe integer")
    expect(() => log.queryProcessed({ limit: -1 })).toThrow(
      "limit must be a non-negative safe integer",
    )
    expect(() => log.queryConnection({ limit: -1 })).toThrow(
      "limit must be a non-negative safe integer",
    )
  } finally {
    log.close()
  }
})
