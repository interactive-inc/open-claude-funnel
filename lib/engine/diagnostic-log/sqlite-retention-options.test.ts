import { expect, test } from "bun:test"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

for (const field of ["maxRows", "rawMaxRows", "maxAgeMs"] as const) {
  test(`diagnostic ${field} is captured once for validation and all applicable tables`, () => {
    let reads = 0
    let now = 0
    const options: ConstructorParameters<typeof SqliteConnectorDiagnosticLog>[0] = {
      rawPath: ":memory:",
      processedPath: ":memory:",
      connectionPath: ":memory:",
      now: () => now,
    }
    Object.defineProperty(options, field, {
      get() {
        return ++reads <= 2 ? (field === "maxAgeMs" ? 0 : 1) : undefined
      },
    })
    const log = new SqliteConnectorDiagnosticLog(options)
    try {
      for (let index = 0; index < 2; index++) {
        now = index
        const ref = { type: "source", connectorId: null, channelId: null }
        log.recordRaw({ ...ref, eventId: String(index), payload: "{}" })
        log.recordProcessed({ ...ref, eventId: String(index), payload: "{}", outcome: "emitted" })
        log.recordConnection({ ...ref, status: "connected", detail: "" })
      }
      expect(log.queryRaw({})).toHaveLength(1)
      expect(log.queryProcessed({})).toHaveLength(field === "rawMaxRows" ? 2 : 1)
      expect(log.queryConnection({})).toHaveLength(field === "rawMaxRows" ? 2 : 1)
      expect(reads).toBe(1)
    } finally {
      log.close()
    }
  })
}
