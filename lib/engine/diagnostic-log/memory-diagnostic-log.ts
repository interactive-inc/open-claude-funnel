import {
  ConnectorDiagnosticLog,
  type ConnectorConnectionQuery,
  type ConnectorConnectionRecord,
  type ConnectorProcessedQuery,
  type ConnectorProcessedRecord,
  type ConnectorQuery,
  type ConnectorRawQuery,
  type ConnectorRawRecord,
  type StoredConnectionEvent,
  type StoredProcessedEvent,
  type StoredRawEvent,
} from "@/engine/diagnostic-log/diagnostic-log"

/**
 * In-process `ConnectorDiagnosticLog` backed by one array per table. Used by tests
 * and embedders that do not need durability. Like the SQLite log it keeps
 * `seq` per-table (each array's 1-based position) and returns the most recent
 * `limit` rows oldest-first; unlike it, it never prunes and never offloads
 * oversized payloads — it keeps whatever the caller hands it, which is fine
 * for the bounded volumes a test produces. Payload-validity is therefore a
 * SQLite-only guarantee; do not write a test that leans on this double
 * rejecting a malformed payload.
 */
export class MemoryConnectorDiagnosticLog extends ConnectorDiagnosticLog {
  private readonly raws: StoredRawEvent[] = []
  private readonly processeds: StoredProcessedEvent[] = []
  private readonly connections: StoredConnectionEvent[] = []

  constructor(private readonly now: () => number = () => Date.now()) {
    super()
    Object.freeze(this)
  }

  recordRaw(record: ConnectorRawRecord): void {
    this.raws.push({ ...record, seq: this.raws.length + 1, ts: this.now() })
  }

  recordProcessed(record: ConnectorProcessedRecord): void {
    this.processeds.push({ ...record, seq: this.processeds.length + 1, ts: this.now() })
  }

  recordConnection(record: ConnectorConnectionRecord): void {
    this.connections.push({ ...record, seq: this.connections.length + 1, ts: this.now() })
  }

  queryRaw(query: ConnectorRawQuery): StoredRawEvent[] {
    const matched = this.raws.filter((event) => {
      if (!matches(event, query)) return false
      if (query.eventId !== undefined && event.eventId !== query.eventId) return false

      return true
    })

    return takeRecent(matched, query.limit)
  }

  queryProcessed(query: ConnectorProcessedQuery): StoredProcessedEvent[] {
    const matched = this.processeds.filter((event) => {
      if (!matches(event, query)) return false
      if (query.eventId !== undefined && event.eventId !== query.eventId) return false
      if (query.outcome !== undefined && event.outcome !== query.outcome) return false
      if (query.outcomePrefix !== undefined && !event.outcome.startsWith(query.outcomePrefix)) {
        return false
      }

      return true
    })

    return takeRecent(matched, query.limit)
  }

  queryConnection(query: ConnectorConnectionQuery): StoredConnectionEvent[] {
    const matched = this.connections.filter((event) => {
      if (!matches(event, query)) return false
      if (query.status !== undefined && event.status !== query.status) return false
      if (query.statuses !== undefined && !query.statuses.includes(event.status)) return false

      return true
    })

    return takeRecent(matched, query.limit)
  }

  clear(): void {
    this.raws.length = 0
    this.processeds.length = 0
    this.connections.length = 0
  }

  close(): void {}
}

const matches = (
  event: { type: string; connectorId: string | null; channelId: string | null },
  query: ConnectorQuery,
): boolean => {
  if (query.type !== undefined && event.type !== query.type) return false
  if (query.connectorId !== undefined && event.connectorId !== query.connectorId) return false
  if (query.channelId !== undefined && event.channelId !== query.channelId) return false
  if ("seq" in event && query.seq !== undefined && event.seq !== query.seq) return false

  return true
}

// Mirrors the SQLite log's "newest `limit`, oldest-first" contract: take the
// tail of the (insertion-ordered) matches, then keep them ascending. Guard
// limit === 0 explicitly — slice(-0) is slice(0), which would return every
// row, whereas SQL `LIMIT 0` returns none. The two impls must agree.
const takeRecent = <T>(events: T[], limit: number | undefined): T[] => {
  if (limit === undefined) return events
  if (limit <= 0) return []

  return events.slice(-limit)
}
