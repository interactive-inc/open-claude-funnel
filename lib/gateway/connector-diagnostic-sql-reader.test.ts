import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConnectorDiagnosticSqlReader } from "@/gateway/connector-diagnostic-sql-reader"
import { SqliteConnectorDiagnosticLog } from "@/gateway/sqlite-connector-diagnostic-log"

// ATTACH needs two real files (":memory:" can't be cross-referenced), so the
// reader is exercised against on-disk DBs the writer produced.
let rawPath = ""
let processedPath = ""
let connectionPath = ""

beforeEach(() => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  rawPath = join(tmpdir(), `raw-sql-reader-raw-${stamp}.db`)
  processedPath = join(tmpdir(), `raw-sql-reader-proc-${stamp}.db`)
  connectionPath = join(tmpdir(), `raw-sql-reader-conn-${stamp}.db`)

  const log = new SqliteConnectorDiagnosticLog({ rawPath, processedPath, connectionPath })

  log.recordConnection({
    type: "slack",
    connectorId: "co-1",
    channelId: "ch-1",
    status: "auth-failed",
    detail: "invalid_auth",
  })

  for (let i = 0; i < 3; i += 1) {
    const eventId = `ev-${i}`
    log.recordRaw({
      eventId,
      type: "slack",
      connectorId: "co-1",
      channelId: "ch-1",
      payload: JSON.stringify({ type: "message", n: i }),
    })
    log.recordProcessed({
      eventId,
      type: "slack",
      connectorId: "co-1",
      channelId: "ch-1",
      outcome: i === 1 ? "skip:dedup" : "emitted",
      payload: "",
    })
  }

  log.close()
})

afterEach(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${rawPath}${suffix}`, { force: true })
    rmSync(`${processedPath}${suffix}`, { force: true })
    rmSync(`${connectionPath}${suffix}`, { force: true })
  }
})

describe("ConnectorDiagnosticSqlReader", () => {
  test("exposes the raw view with payload pulled out of the nested JSON", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const rows = reader.query("SELECT event_id, payload FROM raw ORDER BY seq")

    reader.close()

    expect(rows).not.toBeInstanceOf(Error)
    if (rows instanceof Error) return

    expect(rows).toHaveLength(3)
    expect(rows[0]?.event_id).toBe("ev-0")
    // payload is the original event JSON as text, not the storage envelope.
    expect(JSON.parse(String(rows[0]?.payload)).n).toBe(0)
  })

  test("joins raw and processed on event_id to trace an event's fate", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const rows = reader.query(
      "SELECT r.payload, p.outcome FROM raw r JOIN processed p USING(event_id) WHERE p.outcome = 'skip:dedup'",
    )

    reader.close()

    expect(rows).not.toBeInstanceOf(Error)
    if (rows instanceof Error) return

    expect(rows).toHaveLength(1)
    expect(JSON.parse(String(rows[0]?.payload)).n).toBe(1)
  })

  test("supports aggregation over outcomes", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const rows = reader.query("SELECT outcome, COUNT(*) AS n FROM processed GROUP BY outcome ORDER BY outcome")

    reader.close()

    if (rows instanceof Error) throw rows

    expect(rows).toEqual([
      { outcome: "emitted", n: 2 },
      { outcome: "skip:dedup", n: 1 },
    ])
  })

  test("rejects a non-SELECT statement", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const result = reader.query("DELETE FROM raw")

    reader.close()

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("SELECT")
  })

  test("rejects multiple statements", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const result = reader.query("SELECT 1; DROP TABLE leuco_log")

    reader.close()

    expect(result).toBeInstanceOf(Error)
  })

  test("cannot write even with a SELECT-shaped trick (connection is read-only)", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    // A write disguised behind SELECT keyword still fails: the statement isn't
    // a plain SELECT, and the connection is read-only regardless.
    const result = reader.query("SELECT * FROM raw; INSERT INTO leuco_log (ts) VALUES (9)")

    reader.close()

    expect(result).toBeInstanceOf(Error)
  })

  test("returns the SQL error message for a bad query", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const result = reader.query("SELECT nope FROM raw")

    reader.close()

    expect(result).toBeInstanceOf(Error)
  })

  test("surfaces connection lifecycle (auth-failed) via the connection view", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const rows = reader.query(
      "SELECT status, detail FROM connection WHERE status = 'auth-failed'",
    )

    reader.close()

    if (rows instanceof Error) throw rows

    expect(rows).toEqual([{ status: "auth-failed", detail: "invalid_auth" }])
  })
})
