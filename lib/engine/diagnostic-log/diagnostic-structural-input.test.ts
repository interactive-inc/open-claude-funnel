import { expect, test } from "bun:test"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

const create = (storage: "memory" | "sqlite"): ConnectorDiagnosticLog =>
  storage === "memory"
    ? new MemoryConnectorDiagnosticLog(() => 0)
    : new SqliteConnectorDiagnosticLog({
        rawPath: ":memory:",
        processedPath: ":memory:",
        connectionPath: ":memory:",
        now: () => 0,
      })

class Record {
  #id: string
  constructor(id: string) {
    this.#id = id
  }
  get type() {
    return "source"
  }
  get connectorId() {
    return this.#id
  }
  get channelId() {
    return "channel"
  }
  get eventId() {
    return this.#id
  }
  get payload() {
    return "{}"
  }
  get outcome() {
    return this.#id === "first" ? "skip:filtered" : "emitted"
  }
  get status(): "connected" | "stopped" {
    return this.#id === "first" ? "connected" : "stopped"
  }
  get detail() {
    return this.#id
  }
}

for (const storage of ["memory", "sqlite"] as const) {
  test(`${storage} diagnostic records accept prototype getters without losing stored fields`, () => {
    const log = create(storage)
    try {
      for (const id of ["first", "second"]) {
        const record = new Record(id)
        log.recordRaw(record)
        log.recordProcessed(record)
        log.recordConnection(record)
      }
      for (const rows of [log.queryRaw({}), log.queryProcessed({}), log.queryConnection({})]) {
        expect(
          rows.map(({ seq, type, connectorId, channelId }) => ({
            seq,
            type,
            connectorId,
            channelId,
          })),
        ).toEqual([
          { seq: 1, type: "source", connectorId: "first", channelId: "channel" },
          { seq: 2, type: "source", connectorId: "second", channelId: "channel" },
        ])
      }
      expect(log.queryRaw({}).map(({ eventId, payload }) => ({ eventId, payload }))).toEqual([
        { eventId: "first", payload: "{}" },
        { eventId: "second", payload: "{}" },
      ])
      expect(log.queryProcessed({}).map((row) => row.outcome)).toEqual(["skip:filtered", "emitted"])
      expect(log.queryConnection({}).map((row) => row.status)).toEqual(["connected", "stopped"])
    } finally {
      log.close()
    }
  })

  test(`${storage} diagnostic queries honor inherited scope, bounds and table-specific filters`, () => {
    const log = create(storage)
    class Scope {
      get connectorId() {
        return "first"
      }
    }
    class Empty {
      get limit() {
        return 0
      }
    }
    class Raw {
      get eventId() {
        return "second"
      }
    }
    class Processed {
      get outcomePrefix() {
        return "skip:"
      }
    }
    class Connection {
      get statuses() {
        return ["stopped"] as const
      }
    }
    try {
      for (const id of ["first", "second"]) {
        const record = {
          type: "source",
          connectorId: id,
          channelId: "channel",
          eventId: id,
          payload: "{}",
        }
        log.recordRaw(record)
        log.recordProcessed({ ...record, outcome: id === "first" ? "skip:filtered" : "emitted" })
        log.recordConnection({
          ...record,
          status: id === "first" ? "connected" : "stopped",
          detail: id,
        })
      }
      for (const rows of [
        log.queryRaw(new Scope()),
        log.queryProcessed(new Scope()),
        log.queryConnection(new Scope()),
      ])
        expect(rows.map((row) => row.connectorId)).toEqual(["first"])
      expect(log.queryRaw(new Empty())).toEqual([])
      expect(log.queryProcessed(new Empty())).toEqual([])
      expect(log.queryConnection(new Empty())).toEqual([])
      expect(log.queryRaw(new Raw()).map((row) => row.eventId)).toEqual(["second"])
      expect(log.queryProcessed(new Processed()).map((row) => row.eventId)).toEqual(["first"])
      expect(log.queryConnection(new Connection()).map((row) => row.connectorId)).toEqual([
        "second",
      ])
    } finally {
      log.close()
    }
  })
}
