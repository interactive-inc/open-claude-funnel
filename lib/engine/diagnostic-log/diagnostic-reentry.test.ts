import { expect, test } from "bun:test"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

const ref = (id: string) => ({ type: "source", connectorId: id, channelId: null })
const tables: {
  name: string
  write(log: ConnectorDiagnosticLog, id: string): void
  read(log: ConnectorDiagnosticLog, seq?: number): { seq: number; connectorId: string | null }[]
}[] = [
  {
    name: "raw",
    write: (log, id) => log.recordRaw({ ...ref(id), eventId: id, payload: "{}" }),
    read: (log, seq) => log.queryRaw(seq === undefined ? {} : { seq }),
  },
  {
    name: "processed",
    write: (log, id) =>
      log.recordProcessed({ ...ref(id), eventId: id, payload: "{}", outcome: "emitted" }),
    read: (log, seq) => log.queryProcessed(seq === undefined ? {} : { seq }),
  },
  {
    name: "connection",
    write: (log, id) => log.recordConnection({ ...ref(id), status: "connected", detail: "" }),
    read: (log, seq) => log.queryConnection(seq === undefined ? {} : { seq }),
  },
]

const createLog = (storage: "memory" | "sqlite", now: () => number): ConnectorDiagnosticLog =>
  storage === "memory"
    ? new MemoryConnectorDiagnosticLog(now)
    : new SqliteConnectorDiagnosticLog({
        rawPath: ":memory:",
        processedPath: ":memory:",
        connectionPath: ":memory:",
        now,
      })

for (const storage of ["memory", "sqlite"] as const) {
  for (const table of tables) {
    test(`${storage} ${table.name} clear does not reassign an old sequence to a new diagnostic`, () => {
      const log = createLog(storage, () => 0)
      try {
        table.write(log, "old-first")
        table.write(log, "old-second")
        log.clear()
        expect(table.read(log)).toEqual([])
        table.write(log, "new")
        expect(table.read(log, 1)).toEqual([])
        expect(table.read(log, 2)).toEqual([])
        expect(table.read(log, 3).map((row) => row.connectorId)).toEqual(["new"])
      } finally {
        log.close()
      }
    })

    test(`${storage} ${table.name} sequences remain unique when the clock records a nested diagnostic`, () => {
      let nested = false
      const now = () => {
        if (!nested) {
          nested = true
          table.write(log, "nested")
        }
        return 0
      }
      const log = createLog(storage, now)
      try {
        table.write(log, "outer")
        expect(table.read(log).map(({ seq, connectorId }) => ({ seq, connectorId }))).toEqual([
          { seq: 1, connectorId: "nested" },
          { seq: 2, connectorId: "outer" },
        ])
        expect(table.read(log, 2).map((row) => row.connectorId)).toEqual(["outer"])
      } finally {
        log.close()
      }
    })
  }
}

test("a failed clock cannot insert a partial outer diagnostic or consume its sequence", () => {
  let nested = false
  const failure = new Error("clock failed")
  const log = new MemoryConnectorDiagnosticLog(() => {
    if (!nested) {
      nested = true
      tables[0]!.write(log, "nested")
      throw failure
    }
    return 0
  })
  try {
    expect(() => tables[0]!.write(log, "failed")).toThrow(failure)
    tables[0]!.write(log, "next")
    expect(tables[0]!.read(log).map(({ seq, connectorId }) => ({ seq, connectorId }))).toEqual([
      { seq: 1, connectorId: "nested" },
      { seq: 2, connectorId: "next" },
    ])
  } finally {
    log.close()
  }
})
