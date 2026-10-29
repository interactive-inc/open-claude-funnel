import { expect, test } from "bun:test"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

for (const field of [
  "where",
  "wherePrefix",
  "whereIn",
  "type",
  "limit",
  "seq",
  "sinceSeq",
] as const) {
  test(`SQLite query captures ${field} before applying scope and bounds`, () => {
    const log = new SqliteEventLog<{ type: string; scope: string }, ["scope"]>({
      path: ":memory:",
      indexes: ["scope"],
      extractIndexes: (event) => ({ scope: event.scope }),
    })
    try {
      for (const scope of ["first", "second"])
        expect(log.insert({ ts: 0, event: { type: scope, scope } })).not.toBeInstanceOf(Error)
      let reads = 0
      const props = {}
      Object.defineProperty(props, field, {
        get() {
          const first = ++reads === 1
          if (field === "where") return first ? { scope: "first" } : {}
          if (field === "wherePrefix") return first ? { scope: "fir" } : {}
          if (field === "whereIn") return first ? { scope: ["first"] } : {}
          if (field === "type") return first ? "first" : "second"
          if (field === "limit") return first ? 0 : 10
          if (field === "seq") return first ? 1 : 2
          return first ? 0 : 1
        },
      })
      expect(log.query(props).map((row) => row.seq)).toEqual(
        field === "limit" ? [] : field === "sinceSeq" ? [1, 2] : [1],
      )
      expect(reads).toBe(1)
    } finally {
      log.close()
    }
  })
}

for (const field of ["connectorId", "limit", "sinceSeq"] as const) {
  test(`scoped replay captures ${field} before forwarding the query`, () => {
    const log = new SqliteFunnelEventLog({ path: ":memory:" })
    try {
      for (const [index, connectorId] of ["first", "second"].entries())
        log.record({
          offset: index + 1,
          content: connectorId,
          channelId: "channel",
          connectorId,
          meta: null,
        })
      let reads = 0
      const props = { channelId: "channel" }
      Object.defineProperty(props, field, {
        get() {
          const first = ++reads === 1
          if (field === "connectorId") return first ? "first" : undefined
          if (field === "limit") return first ? 0 : 10
          return first ? 0 : 1
        },
      })
      expect(log.loadForChannel(props).map((row) => row.offset)).toEqual(
        field === "connectorId" ? [1] : field === "limit" ? [] : [1, 2],
      )
      expect(reads).toBe(1)
    } finally {
      log.close()
    }
  })
}

for (const table of ["raw", "processed", "connection"] as const) {
  const fields = [
    "channelId",
    "connectorId",
    "limit",
    "seq",
    "type",
    ...(table === "raw"
      ? ["eventId"]
      : table === "processed"
        ? ["eventId", "outcome", "outcomePrefix"]
        : ["status", "statuses"]),
  ]
  for (const field of fields) {
    test(`SQLite ${table} diagnostics capture ${field} before filtering`, () => {
      const log = new SqliteConnectorDiagnosticLog({
        rawPath: ":memory:",
        processedPath: ":memory:",
        connectionPath: ":memory:",
        now: () => 0,
      })
      try {
        for (const id of ["first", "second"]) {
          const ref = { type: id, channelId: id, connectorId: id }
          log.recordRaw({ ...ref, eventId: id, payload: "{}" })
          log.recordProcessed({ ...ref, eventId: id, payload: "{}", outcome: id })
          log.recordConnection({
            ...ref,
            status: id === "first" ? "connected" : "stopped",
            detail: id,
          })
        }
        let reads = 0
        const props = {}
        Object.defineProperty(props, field, {
          get() {
            const first = ++reads === 1
            if (field === "limit") return first ? 0 : 10
            if (field === "seq") return first ? 1 : 2
            if (field === "outcomePrefix") return first ? "fir" : undefined
            if (field === "status") return first ? "connected" : undefined
            if (field === "statuses") return first ? ["connected"] : undefined
            return first ? "first" : undefined
          },
        })
        const rows =
          table === "raw"
            ? log.queryRaw(props)
            : table === "processed"
              ? log.queryProcessed(props)
              : log.queryConnection(props)
        expect(rows.map((row) => row.seq)).toEqual(field === "limit" ? [] : [1])
        expect(reads).toBe(1)
      } finally {
        log.close()
      }
    })
  }
}
