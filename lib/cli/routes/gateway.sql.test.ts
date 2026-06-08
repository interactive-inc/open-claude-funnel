import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PRESETS, PRESETS_BY_CHANNEL } from "@/cli/routes/gateway.sql"
import type { ConnectorConnectionStatus } from "@/gateway/diagnostic-log/diagnostic-log"
import { ConnectorDiagnosticSqlReader } from "@/gateway/diagnostic-log/diagnostic-sql-reader"
import { SqliteConnectorDiagnosticLog } from "@/gateway/diagnostic-log/sqlite-diagnostic-log"

const isBun = typeof globalThis.Bun !== "undefined"

// ATTACH needs real files (":memory:" can't be cross-referenced), so the preset
// SQL is exercised against on-disk DBs seeded for two channels.
let rawPath = ""
let processedPath = ""
let connectionPath = ""

const seedChannel = (
  log: SqliteConnectorDiagnosticLog,
  channelId: string,
  outcomes: string[],
  status: ConnectorConnectionStatus,
): void => {
  log.recordConnection({ type: "slack", connectorId: "co", channelId, status, detail: "d" })

  for (let i = 0; i < outcomes.length; i += 1) {
    const eventId = `${channelId}-ev-${i}`

    log.recordRaw({
      eventId,
      type: "slack",
      connectorId: "co",
      channelId,
      payload: JSON.stringify({ type: "message", channelId, n: i }),
    })
    log.recordProcessed({
      eventId,
      type: "slack",
      connectorId: "co",
      channelId,
      outcome: outcomes[i] ?? "emitted",
      payload: "",
    })
  }
}

beforeEach(() => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  rawPath = join(tmpdir(), `gw-sql-raw-${stamp}.db`)
  processedPath = join(tmpdir(), `gw-sql-proc-${stamp}.db`)
  connectionPath = join(tmpdir(), `gw-sql-conn-${stamp}.db`)

  const log = new SqliteConnectorDiagnosticLog({ rawPath, processedPath, connectionPath })

  seedChannel(log, "ch-1", ["emitted", "skip:dedup"], "auth-failed")
  seedChannel(log, "ch-2", ["skip:dedup", "emitted"], "error")

  log.close()
})

afterEach(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${rawPath}${suffix}`, { force: true })
    rmSync(`${processedPath}${suffix}`, { force: true })
    rmSync(`${connectionPath}${suffix}`, { force: true })
  }
})

describe.skipIf(!isBun)("gateway sql presets", () => {
  test("channel-filtered presets cover the same keys as the base presets", () => {
    expect(Object.keys(PRESETS_BY_CHANNEL).sort()).toEqual(Object.keys(PRESETS).sort())
  })

  // The previous regex-injected `WHERE channel_id = ?` produced double-WHERE
  // SQL for skipped/errors and split the `raw r` alias for trace-dedup. Running
  // every channel-filtered preset against a real DB pins that they are valid.
  test("every channel-filtered preset runs without a SQL error", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    for (const sql of Object.values(PRESETS_BY_CHANNEL)) {
      const rows = reader.query(sql, ["ch-1"])
      expect(rows).not.toBeInstanceOf(Error)
    }

    reader.close()
  })

  test("the channel filter excludes other channels", () => {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const skipped = reader.query(PRESETS_BY_CHANNEL.skipped ?? "", ["ch-1"])
    const errors = reader.query(PRESETS_BY_CHANNEL.errors ?? "", ["ch-1"])
    const traceDedup = reader.query(PRESETS_BY_CHANNEL["trace-dedup"] ?? "", ["ch-1"])
    const recent = reader.query(PRESETS_BY_CHANNEL.recent ?? "", ["ch-1"])

    reader.close()

    if (skipped instanceof Error) throw skipped
    if (errors instanceof Error) throw errors
    if (traceDedup instanceof Error) throw traceDedup
    if (recent instanceof Error) throw recent

    // ch-1 has exactly one skip:* outcome, one auth-failed connection, one
    // dedup-traced raw, and two processed rows total. ch-2 data is filtered out.
    expect(skipped).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(traceDedup).toHaveLength(1)
    expect(recent).toHaveLength(2)
    expect(JSON.parse(String(traceDedup[0]?.payload)).channelId).toBe("ch-1")
  })
})
