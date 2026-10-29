import { snapshotDiagnosticQuery } from "@/engine/diagnostic-log/query-snapshot"
import { requireTimestamp } from "@/require-timestamp"
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
 * monotonic `seq` per-table, preserved after clear, and returns the most recent
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
  private readonly sequences = { raw: 0, processed: 0, connection: 0 }

  constructor(private readonly now: () => number = () => Date.now()) {
    super()
    Object.freeze(this)
  }

  recordRaw(record: ConnectorRawRecord): void {
    const { eventId, type, connectorId, channelId, payload } = record
    const event = {
      eventId,
      type,
      connectorId,
      channelId,
      payload,
      ts: requireTimestamp(this.now()),
    }
    this.raws.push({ ...event, seq: ++this.sequences.raw })
  }

  recordProcessed(record: ConnectorProcessedRecord): void {
    const { eventId, type, connectorId, channelId, outcome, payload } = record
    const event = {
      eventId,
      type,
      connectorId,
      channelId,
      outcome,
      payload,
      ts: requireTimestamp(this.now()),
    }
    this.processeds.push({ ...event, seq: ++this.sequences.processed })
  }

  recordConnection(record: ConnectorConnectionRecord): void {
    const { type, connectorId, channelId, status, detail } = record
    const event = { type, connectorId, channelId, status, detail, ts: requireTimestamp(this.now()) }
    this.connections.push({ ...event, seq: ++this.sequences.connection })
  }

  queryRaw(query: ConnectorRawQuery): StoredRawEvent[] {
    const options = { ...snapshotDiagnosticQuery(query), eventId: query.eventId }
    const matched = this.raws.filter((event) => {
      if (!matches(event, options)) return false
      if (options.eventId !== undefined && event.eventId !== options.eventId) return false

      return true
    })

    return takeRecent(matched, options.limit)
  }

  queryProcessed(query: ConnectorProcessedQuery): StoredProcessedEvent[] {
    const options = {
      ...snapshotDiagnosticQuery(query),
      eventId: query.eventId,
      outcome: query.outcome,
      outcomePrefix: query.outcomePrefix,
    }
    const matched = this.processeds.filter((event) => {
      if (!matches(event, options)) return false
      if (options.eventId !== undefined && event.eventId !== options.eventId) return false
      if (options.outcome !== undefined && event.outcome !== options.outcome) return false
      if (options.outcomePrefix !== undefined && !event.outcome.startsWith(options.outcomePrefix)) {
        return false
      }

      return true
    })

    return takeRecent(matched, options.limit)
  }

  queryConnection(query: ConnectorConnectionQuery): StoredConnectionEvent[] {
    const options = {
      ...snapshotDiagnosticQuery(query),
      status: query.status,
      statuses: query.statuses,
    }
    if (options.statuses !== undefined) options.statuses = [...options.statuses]
    const matched = this.connections.filter((event) => {
      if (!matches(event, options)) return false
      if (options.status !== undefined && event.status !== options.status) return false
      if (options.statuses !== undefined && !options.statuses.includes(event.status)) return false

      return true
    })

    return takeRecent(matched, options.limit)
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
const takeRecent = <T extends object>(events: T[], limit: number | undefined): T[] => {
  const selected = limit === undefined ? events : limit <= 0 ? [] : events.slice(-limit)
  return selected.map((event) => ({ ...event }))
}
