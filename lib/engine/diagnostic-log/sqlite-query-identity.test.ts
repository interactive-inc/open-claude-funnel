import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

for (const table of ["raw", "processed", "connection"] as const) {
  for (const [column, field] of [
    ["channel_id", "channelId"],
    ["connector_id", "connectorId"],
    ["type", "type"],
  ] as const) {
    test(`${table} diagnostics reject a ${column} index that conflicts with the stored scope`, () => {
      const directory = mkdtempSync(join(tmpdir(), "funnel-diagnostic-identity-"))
      const paths = {
        rawPath: join(directory, "raw.db"),
        processedPath: join(directory, "processed.db"),
        connectionPath: join(directory, "connection.db"),
      }
      const log = new SqliteConnectorDiagnosticLog(paths)
      const database = new Database(paths[`${table}Path`])
      try {
        const scope = { type: "original", channelId: "original", connectorId: "original" }
        if (table === "raw") log.recordRaw({ ...scope, eventId: "event", payload: "{}" })
        else if (table === "processed")
          log.recordProcessed({ ...scope, eventId: "event", outcome: "emitted", payload: "{}" })
        else log.recordConnection({ ...scope, status: "connected", detail: "original" })
        const query = () => {
          const filter = { [field]: "other" }
          if (table === "raw") return log.queryRaw(filter)
          if (table === "processed") return log.queryProcessed(filter)
          return log.queryConnection(filter)
        }
        expect(query()).toEqual([])
        database.query(`UPDATE logs SET ${column} = ?`).run("other")
        expect(query).toThrow("diagnostic routing index conflicts with stored identity")
        database.query(`UPDATE logs SET ${column} = ?`).run("original")
        expect(query()).toEqual([])
        const restored =
          table === "raw"
            ? log.queryRaw(scope)
            : table === "processed"
              ? log.queryProcessed(scope)
              : log.queryConnection(scope)
        expect(restored).toHaveLength(1)
        expect(restored[0]).toMatchObject(scope)
      } finally {
        database.close()
        log.close()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}

for (const scenario of [
  { table: "raw", column: "event_id", value: "other", filter: { eventId: "other" } },
  { table: "processed", column: "event_id", value: "other", filter: { eventId: "other" } },
  { table: "processed", column: "outcome", value: "skip:other", filter: { outcome: "skip:other" } },
  {
    table: "processed",
    column: "outcome",
    value: "skip:other",
    filter: { outcomePrefix: "skip:" },
  },
  { table: "connection", column: "status", value: "error", filter: { status: "error" } },
  { table: "connection", column: "status", value: "error", filter: { statuses: ["error"] } },
] as const) {
  test(`${scenario.table} diagnostics reject inconsistent ${Object.keys(scenario.filter)[0]} filtering`, () => {
    const directory = mkdtempSync(join(tmpdir(), "funnel-diagnostic-filter-"))
    const paths = {
      rawPath: join(directory, "raw.db"),
      processedPath: join(directory, "processed.db"),
      connectionPath: join(directory, "connection.db"),
    }
    const log = new SqliteConnectorDiagnosticLog(paths)
    const database = new Database(paths[`${scenario.table}Path`])
    try {
      const scope = { type: "example", channelId: "channel", connectorId: "connector" }
      log.recordRaw({ ...scope, eventId: "original", payload: "{}" })
      log.recordProcessed({ ...scope, eventId: "original", outcome: "emitted", payload: "{}" })
      log.recordConnection({ ...scope, status: "connected", detail: "original" })
      const query = () =>
        scenario.table === "raw"
          ? log.queryRaw(scenario.filter)
          : scenario.table === "processed"
            ? log.queryProcessed(scenario.filter)
            : log.queryConnection(scenario.filter)
      expect(query()).toEqual([])
      database.query(`UPDATE logs SET ${scenario.column} = ?`).run(scenario.value)
      expect(query).toThrow("diagnostic filter index conflicts with stored event")
      const original =
        scenario.column === "event_id"
          ? "original"
          : scenario.column === "outcome"
            ? "emitted"
            : "connected"
      database.query(`UPDATE logs SET ${scenario.column} = ?`).run(original)
      expect(query()).toEqual([])
    } finally {
      database.close()
      log.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
