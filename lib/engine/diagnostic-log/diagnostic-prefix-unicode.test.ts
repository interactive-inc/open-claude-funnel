import { expect, test } from "bun:test"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

for (const high of [0xd800, 0xd83d, 0xdbff]) {
  for (const [label, leading] of [
    ["empty", ""],
    ["text", "emitted:"],
    ["null", "emitted\0"],
    ["mixed", "😀\udfff"],
  ] as const) {
    test(`${label} prefix ending in high surrogate ${high.toString(16)} matches before limiting`, () => {
      const memory = new MemoryConnectorDiagnosticLog(() => 0)
      const sqlite = new SqliteConnectorDiagnosticLog({
        rawPath: ":memory:",
        processedPath: ":memory:",
        connectionPath: ":memory:",
        now: () => 0,
      })
      const first = 0x10000 + (high - 0xd800) * 0x400
      const prefix = leading + String.fromCharCode(high)
      const outside = high === 0xdbff ? 0x10000 : first + 0x400
      const outcomes = [
        `${prefix}unpaired`,
        `${leading}${String.fromCodePoint(first)}first`,
        `${leading}${String.fromCodePoint(first + 0x3ff)}last`,
        `${leading}${String.fromCodePoint(outside)}outside`,
        `${leading}\udfff`,
        `other${prefix}`,
        `${leading}${String.fromCodePoint(first)}newest`,
      ]
      try {
        for (const [index, outcome] of outcomes.entries()) {
          const record = {
            type: "source",
            eventId: String(index),
            channelId: "channel",
            connectorId: "connector",
            outcome,
            payload: String(index),
          }
          memory.recordProcessed(record)
          sqlite.recordProcessed(record)
        }
        for (const limit of [0, 1, 2, 100]) {
          const query = { outcomePrefix: prefix, limit }
          const expected = outcomes
            .map((outcome, index) => ({ outcome, payload: String(index) }))
            .filter(({ outcome }) => outcome.startsWith(prefix))
            .slice(limit === 0 ? outcomes.length : -limit)
            .map(({ payload }) => payload)
          expect(memory.queryProcessed(query).map(({ payload }) => payload)).toEqual(expected)
          expect(sqlite.queryProcessed(query).map(({ payload }) => payload)).toEqual(expected)
        }
      } finally {
        sqlite.close()
      }
    })
  }
}

test("all diagnostic string filters preserve distinct unpaired-surrogate sequences", () => {
  const memory = new MemoryConnectorDiagnosticLog(() => 0)
  const sqlite = new SqliteConnectorDiagnosticLog({
    rawPath: ":memory:",
    processedPath: ":memory:",
    connectionPath: ":memory:",
    now: () => 0,
  })
  const values = [
    "\udfff\udbff",
    "\udfff\udfff",
    "😀\udfff\udbff",
    "😀\udfff\udfff",
    "\ud800\ud800",
    String.fromCodePoint(0x10000),
    String.fromCodePoint(0x10ffff),
  ]
  try {
    for (const [index, value] of values.entries()) {
      const record = {
        eventId: value,
        type: value,
        channelId: value,
        connectorId: value,
        outcome: value,
        payload: String(index),
      }
      memory.recordProcessed(record)
      sqlite.recordProcessed(record)
    }
    for (const value of values) {
      for (const field of ["eventId", "type", "channelId", "connectorId", "outcome"] as const) {
        const query = { [field]: value, limit: 100 }
        expect(sqlite.queryProcessed(query)).toEqual(memory.queryProcessed(query))
      }
    }
  } finally {
    sqlite.close()
  }
})
