import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"
import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import type { ServerWebSocket } from "bun"

const invalidIntegers = [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]

for (const field of ["maxRows", "maxBytes"] as const) {
  test(`memory storage rejects invalid ${field} before it can disable retention`, () => {
    for (const value of invalidIntegers)
      expect(() => {
        new MemoryFunnelEventLog({ [field]: value })
      }).toThrow(`${field} must be a non-negative safe integer`)
  })
}

for (const field of ["maxBufferedBytes", "replayBufferSize", "replayBufferMaxBytes"] as const) {
  test(`broadcasting rejects invalid ${field} instead of silently disabling its limit`, () => {
    for (const value of invalidIntegers)
      expect(() => {
        new FunnelBroadcaster({ [field]: value })
      }).toThrow(`${field} must be a non-negative safe integer`)
  })

  test(`broadcasting rejects an invalid first ${field} value without rereading it`, () => {
    let reads = 0
    const options: ConstructorParameters<typeof FunnelBroadcaster>[0] = {}
    Object.defineProperty(options, field, {
      get() {
        return ++reads === 1 ? NaN : 1000
      },
    })
    expect(() => new FunnelBroadcaster(options)).toThrow(
      `${field} must be a non-negative safe integer`,
    )
    expect(reads).toBe(1)
  })

  test(`broadcasting captures ${field} once and preserves an explicit zero limit`, () => {
    let reads = 0
    const options: ConstructorParameters<typeof FunnelBroadcaster>[0] = {}
    Object.defineProperty(options, field, {
      get() {
        return ++reads === 1 ? 0 : 1000
      },
    })
    const broadcaster = new FunnelBroadcaster(options)
    const sent: string[] = []
    const closed: number[] = []
    if (field === "maxBufferedBytes") {
      const socket = {
        getBufferedAmount: () => 1,
        send(payload: string) {
          sent.push(payload)
          return 1
        },
        close(code: number) {
          closed.push(code)
        },
      } as unknown as ServerWebSocket<unknown>
      broadcaster.addClient(socket, { channel: "ops", connectors: [] })
    }
    broadcaster.broadcast("input")
    if (field === "maxBufferedBytes") {
      expect(sent).toEqual([])
      expect(closed).toEqual([1009])
      expect(broadcaster.getMetrics().droppedSlowClients).toBe(1)
    } else {
      expect(broadcaster.replaySince(0, { channel: "ops", connectors: [] })).toEqual([])
      expect(broadcaster.getMetrics().oldestReplayableOffset).toBeNull()
    }
    expect(reads).toBe(1)
  })
}

for (const field of ["maxRows", "maxBytes", "targetBytes"] as const) {
  test(`SQLite storage rejects invalid ${field} during construction`, () => {
    for (const value of invalidIntegers)
      expect(() => {
        new SqliteEventLog<string>({ path: ":memory:", maxBytes: 100, [field]: value }).close()
      }).toThrow(`${field} must be a non-negative safe integer`)
  })
}

test("invalid SQLite retention durations are rejected before use", () => {
  for (const maxAgeMs of [-1, NaN, Infinity])
    expect(() => {
      new SqliteEventLog<string>({ path: ":memory:", maxAgeMs }).close()
    }).toThrow("maxAgeMs must be a non-negative finite number")
})

test("invalid retention and shrink settings cannot create database directories or files", () => {
  const root = mkdtempSync(join(tmpdir(), "funnel-invalid-limits-"))
  const cases = [
    { maxRows: NaN },
    { maxBytes: -1 },
    { maxBytes: 10, targetBytes: 11 },
    { targetBytes: 0 },
  ]
  try {
    for (const [index, options] of cases.entries()) {
      const path = join(root, String(index), "events.db")
      expect(() => {
        new SqliteEventLog<string>({ path, ...options }).close()
      }).toThrow()
      expect(existsSync(dirname(path))).toBe(false)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("memory retention settings are detached from the caller's mutable options", () => {
  const options = { maxRows: 1, maxBytes: 10 }
  const log = new MemoryFunnelEventLog(options)
  options.maxRows = NaN
  options.maxBytes = NaN
  const record = (offset: number, content: string) =>
    log.record({ offset, content, channelId: null, connectorId: null, meta: null })
  record(1, "a")
  record(2, "b")
  expect(log.loadSince(0).map((event) => event.content)).toEqual(["b"])
  record(3, "x".repeat(20))
  expect(log.loadSince(0)).toEqual([])
  expect(log.findMaxOffset()).toBe(3)
})

test("zero limits and fractional millisecond durations keep their explicit semantics", () => {
  const memory = new MemoryFunnelEventLog({ maxRows: 0, maxBytes: 0 })
  memory.record({ offset: 1, content: "a", channelId: null, connectorId: null, meta: null })
  expect(memory.loadSince(0)).toEqual([])
  expect(memory.findMaxOffset()).toBe(1)
  const broadcaster = new FunnelBroadcaster({
    maxBufferedBytes: 0,
    replayBufferSize: 0,
    replayBufferMaxBytes: 0,
  })
  broadcaster.broadcast("a")
  expect(broadcaster.replaySince(0, { channel: "ops", connectors: [] })).toEqual([])
  const sqlite = new SqliteEventLog<string>({ path: ":memory:", maxAgeMs: 0.5, now: () => 1 })
  try {
    expect(sqlite.insert({ ts: 0, event: "expired" })).not.toBeInstanceOf(Error)
    expect(sqlite.insert({ ts: 1, event: "retained" })).not.toBeInstanceOf(Error)
    expect(sqlite.query().map((record) => record.event)).toEqual(["retained"])
  } finally {
    sqlite.close()
  }
})

test("diagnostic retention settings are validated before opening any of its databases", () => {
  const root = mkdtempSync(join(tmpdir(), "funnel-invalid-diagnostic-limits-"))
  try {
    for (const [index, options] of [
      { maxRows: NaN, rawMaxRows: 1 },
      { rawMaxRows: -1 },
      { maxAgeMs: Infinity },
    ].entries()) {
      const directory = join(root, String(index))
      expect(
        () =>
          new SqliteConnectorDiagnosticLog({
            rawPath: join(directory, "raw.db"),
            processedPath: join(directory, "processed.db"),
            connectionPath: join(directory, "connection.db"),
            ...options,
          }),
      ).toThrow()
      expect(existsSync(directory)).toBe(false)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
