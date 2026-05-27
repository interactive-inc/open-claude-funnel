import { describe, expect, test } from "bun:test"
import { ConnectorDiagnosticLog } from "@/gateway/connector-diagnostic-log"
import { MemoryConnectorDiagnosticLog } from "@/gateway/memory-connector-diagnostic-log"
import { SqliteConnectorDiagnosticLog } from "@/gateway/sqlite-connector-diagnostic-log"

const buildSqlite = (): SqliteConnectorDiagnosticLog => {
  return new SqliteConnectorDiagnosticLog({
    rawPath: ":memory:",
    processedPath: ":memory:",
    connectionPath: ":memory:",
  })
}

// Both implementations must behave identically against the port contract, so
// every behavioral test runs against both. The Sqlite one also gets the
// oversize test below, which is implementation-specific.
const implementations: { name: string; build: () => ConnectorDiagnosticLog }[] = [
  { name: "MemoryConnectorDiagnosticLog", build: () => new MemoryConnectorDiagnosticLog() },
  { name: "SqliteConnectorDiagnosticLog", build: buildSqlite },
]

const raw = (over: Partial<Parameters<ConnectorDiagnosticLog["recordRaw"]>[0]> = {}) => ({
  eventId: "ev-1",
  type: "slack",
  connectorId: "co-1",
  channelId: "ch-1",
  payload: "{}",
  ...over,
})

const processed = (over: Partial<Parameters<ConnectorDiagnosticLog["recordProcessed"]>[0]> = {}) => ({
  eventId: "ev-1",
  type: "slack",
  connectorId: "co-1",
  channelId: "ch-1",
  outcome: "emitted",
  payload: "",
  ...over,
})

const connection = (
  over: Partial<Parameters<ConnectorDiagnosticLog["recordConnection"]>[0]> = {},
) =>
  ({
    type: "slack",
    connectorId: "co-1",
    channelId: "ch-1",
    status: "connected",
    detail: "",
    ...over,
  }) satisfies Parameters<ConnectorDiagnosticLog["recordConnection"]>[0]

for (const impl of implementations) {
  describe(impl.name, () => {
    test("records and reads back a raw event", () => {
      const log = impl.build()

      log.recordRaw(raw({ payload: JSON.stringify({ type: "message", text: "hi" }) }))

      const rows = log.queryRaw({})

      expect(rows).toHaveLength(1)
      expect(rows[0]?.eventId).toBe("ev-1")
      expect(rows[0]?.type).toBe("slack")
      expect(rows[0]?.connectorId).toBe("co-1")
      expect(rows[0]?.channelId).toBe("ch-1")
      expect(JSON.parse(rows[0]?.payload ?? "")).toEqual({ type: "message", text: "hi" })

      log.close()
    })

    test("keeps raw and processed in separate tables", () => {
      const log = impl.build()

      log.recordRaw(raw())
      log.recordProcessed(processed({ outcome: "skip:dedup" }))

      expect(log.queryRaw({})).toHaveLength(1)
      expect(log.queryProcessed({})).toHaveLength(1)
      // A raw query never returns the processed verdict and vice versa.
      expect(log.queryProcessed({})[0]?.outcome).toBe("skip:dedup")

      log.close()
    })

    test("shares one eventId across the raw and processed rows of an event", () => {
      const log = impl.build()

      log.recordRaw(raw({ eventId: "ev-42" }))
      log.recordProcessed(processed({ eventId: "ev-42", outcome: "skip:dedup" }))

      // The correlation the type was designed for: find a raw row, then its
      // processed twin by the shared eventId.
      const rawRow = log.queryRaw({})[0]
      const twin = log.queryProcessed({}).find((row) => row.eventId === rawRow?.eventId)

      expect(twin?.outcome).toBe("skip:dedup")

      log.close()
    })

    test("filters by type", () => {
      const log = impl.build()

      log.recordRaw(raw({ type: "slack" }))
      log.recordRaw(raw({ type: "discord", connectorId: "co-2" }))

      const slackOnly = log.queryRaw({ type: "slack" })

      expect(slackOnly).toHaveLength(1)
      expect(slackOnly[0]?.type).toBe("slack")

      log.close()
    })

    test("filters processed rows by outcome", () => {
      const log = impl.build()

      log.recordProcessed(processed({ outcome: "emitted", payload: "body" }))
      log.recordProcessed(processed({ outcome: "skip:dedup" }))

      const dropped = log.queryProcessed({ outcome: "skip:dedup" })

      expect(dropped).toHaveLength(1)
      expect(dropped[0]?.outcome).toBe("skip:dedup")

      log.close()
    })

    test("filters by connector and channel id", () => {
      const log = impl.build()

      log.recordRaw(raw({ connectorId: "co-1", channelId: "ch-1" }))
      log.recordRaw(raw({ connectorId: "co-2", channelId: "ch-2" }))

      expect(log.queryRaw({ connectorId: "co-1" })).toHaveLength(1)
      expect(log.queryRaw({ channelId: "ch-2" })).toHaveLength(1)

      log.close()
    })

    test("limit returns the most recent rows, oldest first", () => {
      const log = impl.build()

      for (let i = 0; i < 5; i += 1) {
        log.recordRaw(raw({ eventId: `ev-${i}`, payload: JSON.stringify({ n: i }) }))
      }

      const rows = log.queryRaw({ limit: 2 })

      // The two newest (n:3, n:4), returned oldest-first.
      expect(rows).toHaveLength(2)
      expect(JSON.parse(rows[0]?.payload ?? "").n).toBe(3)
      expect(JSON.parse(rows[1]?.payload ?? "").n).toBe(4)

      log.close()
    })

    test("limit of 0 returns nothing (not everything)", () => {
      const log = impl.build()

      log.recordRaw(raw())
      log.recordRaw(raw({ eventId: "ev-2" }))

      // Regression guard: Memory's slice(-0) would otherwise return all rows,
      // diverging from SQL LIMIT 0. Both impls must return [].
      expect(log.queryRaw({ limit: 0 })).toHaveLength(0)

      log.close()
    })

    test("records connection lifecycle and filters by status", () => {
      const log = impl.build()

      log.recordConnection(connection({ status: "started" }))
      log.recordConnection(connection({ status: "auth-failed", detail: "invalid_auth" }))
      log.recordConnection(connection({ status: "connected" }))

      expect(log.queryConnection({})).toHaveLength(3)

      const failures = log.queryConnection({ status: "auth-failed" })
      expect(failures).toHaveLength(1)
      expect(failures[0]?.detail).toBe("invalid_auth")

      log.close()
    })

    test("keeps connection rows out of the raw and processed views", () => {
      const log = impl.build()

      log.recordConnection(connection({ status: "connected" }))

      expect(log.queryRaw({})).toHaveLength(0)
      expect(log.queryProcessed({})).toHaveLength(0)
      expect(log.queryConnection({})).toHaveLength(1)

      log.close()
    })
  })
}

describe("SqliteConnectorDiagnosticLog oversize handling", () => {
  test("offloads a payload over the cap to metadata-only, staying valid JSON", () => {
    const log = buildSqlite()
    const huge = "x".repeat(300 * 1024)
    const payload = JSON.stringify({ type: "message", channel: "C1", ts: "1.0", text: huge })

    log.recordRaw(raw({ payload }))

    const rows = log.queryRaw({})
    const stored = JSON.parse(rows[0]?.payload ?? "") as Record<string, unknown>

    expect(stored._funnel_oversized).toBeGreaterThan(256 * 1024)
    expect(stored.type).toBe("message")
    expect(stored.channel).toBe("C1")
    expect(stored.ts).toBe("1.0")
    // The giant body is gone, not truncated mid-string.
    expect(stored.text).toBeUndefined()

    log.close()
  })

  test("keeps a payload under the cap verbatim", () => {
    const log = buildSqlite()
    const payload = JSON.stringify({ type: "message", text: "small" })

    log.recordRaw(raw({ payload }))

    const stored = JSON.parse(log.queryRaw({})[0]?.payload ?? "") as Record<string, unknown>

    expect(stored.text).toBe("small")
    expect(stored._funnel_oversized).toBeUndefined()

    log.close()
  })
})
