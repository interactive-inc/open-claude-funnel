import {
  type ConnectorConnectionEvent,
  type ConnectorConnectionQuery,
  type ConnectorConnectionRecord,
  type ConnectorConnectionStatus,
  connectorConnectionEventSchema,
  type ConnectorProcessedEvent,
  type ConnectorProcessedQuery,
  type ConnectorProcessedRecord,
  type ConnectorQuery,
  type ConnectorRawEvent,
  ConnectorDiagnosticLog,
  type ConnectorRawQuery,
  type ConnectorRawRecord,
  type StoredConnectionEvent,
  type StoredProcessedEvent,
  type StoredRawEvent,
} from "@/gateway/connector-diagnostic-log"
import { LeucoLoggerSqliteSink } from "@/logger/leuco-logger-sqlite-sink"

/**
 * Cap on a raw payload kept verbatim. The point of the raw table is to see
 * what Slack/Discord actually sent, and a typical event is a few KB — so 256
 * KiB keeps essentially everything intact while bounding the rare giant
 * payload (a huge Block Kit message, a file dump) that would otherwise let a
 * single row bloat the debug database without limit.
 */
const RAW_PAYLOAD_CAP = 256 * 1024

type RawIndexes = ["event_id", "connector_id", "channel_id"]
type ProcessedIndexes = ["event_id", "connector_id", "channel_id", "outcome"]
type ConnectionIndexes = ["connector_id", "channel_id", "status"]

type Props = {
  /** SQLite file for the raw (pre-filter) table. ":memory:" for tests. */
  rawPath: string
  /** SQLite file for the processed (verdict) table. ":memory:" for tests. */
  processedPath: string
  /** SQLite file for the connection (lifecycle) table. ":memory:" for tests. */
  connectionPath: string
  now?: () => number
  /** Optional per-table row cap, pruned on every insert. */
  maxRows?: number
  /** Optional per-table age cap in ms, pruned on every insert. */
  maxAgeMs?: number
}

type WhereClause = { connector_id?: string | null; channel_id?: string | null }

/**
 * Default `ConnectorDiagnosticLog`: three independent `LeucoLoggerSqliteSink`s, one
 * per table (raw / processed / connection), in separate files. Each sink
 * indexes the columns its queries filter on — `event_id` / `connector_id` /
 * `channel_id` for raw, plus `outcome` for processed and `status` for
 * connection — so those lookups are indexed scans (`type` is a fixed column
 * the sink extracts separately, not an index, so filtering by it is a scan).
 *
 * The raw table offloads any payload over `RAW_PAYLOAD_CAP`: rather than
 * truncating mid-string (which yields unparseable JSON), it replaces the
 * body with a small JSON object that keeps the diagnostic essentials and
 * records the dropped size under `_funnel_oversized`. Every stored payload
 * therefore stays valid JSON.
 */
export class SqliteConnectorDiagnosticLog extends ConnectorDiagnosticLog {
  private readonly raw: LeucoLoggerSqliteSink<ConnectorRawEvent, RawIndexes>
  private readonly processed: LeucoLoggerSqliteSink<ConnectorProcessedEvent, ProcessedIndexes>
  private readonly connection: LeucoLoggerSqliteSink<ConnectorConnectionEvent, ConnectionIndexes>
  private readonly now: () => number

  constructor(props: Props) {
    super()
    this.now = props.now ?? (() => Date.now())
    const caps = {
      now: this.now,
      ...(props.maxRows !== undefined ? { maxRows: props.maxRows } : {}),
      ...(props.maxAgeMs !== undefined ? { maxAgeMs: props.maxAgeMs } : {}),
    }
    this.raw = new LeucoLoggerSqliteSink<ConnectorRawEvent, RawIndexes>({
      path: props.rawPath,
      indexes: ["event_id", "connector_id", "channel_id"],
      extractIndexes: (event) => ({
        event_id: event.event_id,
        connector_id: event.connector_id,
        channel_id: event.channel_id,
      }),
      ...caps,
    })
    this.processed = new LeucoLoggerSqliteSink<ConnectorProcessedEvent, ProcessedIndexes>({
      path: props.processedPath,
      indexes: ["event_id", "connector_id", "channel_id", "outcome"],
      extractIndexes: (event) => ({
        event_id: event.event_id,
        connector_id: event.connector_id,
        channel_id: event.channel_id,
        outcome: event.outcome,
      }),
      ...caps,
    })
    this.connection = new LeucoLoggerSqliteSink<ConnectorConnectionEvent, ConnectionIndexes>({
      path: props.connectionPath,
      indexes: ["connector_id", "channel_id", "status"],
      extractIndexes: (event) => ({
        connector_id: event.connector_id,
        channel_id: event.channel_id,
        status: event.status,
      }),
      ...caps,
    })
    Object.freeze(this)
  }

  recordRaw(record: ConnectorRawRecord): void {
    const event: ConnectorRawEvent = {
      event_id: record.eventId,
      type: record.type,
      connector_id: record.connectorId,
      channel_id: record.channelId,
      payload: capPayload(record.payload, record.type),
    }
    this.raw.insert({ ts: this.now(), event })
  }

  recordProcessed(record: ConnectorProcessedRecord): void {
    const event: ConnectorProcessedEvent = {
      event_id: record.eventId,
      type: record.type,
      connector_id: record.connectorId,
      channel_id: record.channelId,
      outcome: record.outcome,
      payload: record.payload,
    }
    this.processed.insert({ ts: this.now(), event })
  }

  recordConnection(record: ConnectorConnectionRecord): void {
    const event: ConnectorConnectionEvent = {
      type: record.type,
      connector_id: record.connectorId,
      channel_id: record.channelId,
      status: record.status,
      detail: record.detail,
    }
    this.connection.insert({ ts: this.now(), event })
  }

  queryRaw(query: ConnectorRawQuery): StoredRawEvent[] {
    const records = this.raw.getRecords({
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      where: buildWhere(query),
      order: "desc",
    })

    return records.map((record) => ({
      seq: record.seq,
      ts: record.ts,
      eventId: record.event.event_id,
      type: record.event.type,
      connectorId: record.event.connector_id,
      channelId: record.event.channel_id,
      payload: record.event.payload,
    }))
  }

  queryProcessed(query: ConnectorProcessedQuery): StoredProcessedEvent[] {
    const where: WhereClause & { outcome?: string } = buildWhere(query)
    if (query.outcome !== undefined) where.outcome = query.outcome

    const records = this.processed.getRecords({
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      where,
      order: "desc",
    })

    return records.map((record) => ({
      seq: record.seq,
      ts: record.ts,
      eventId: record.event.event_id,
      type: record.event.type,
      connectorId: record.event.connector_id,
      channelId: record.event.channel_id,
      outcome: record.event.outcome,
      payload: record.event.payload,
    }))
  }

  queryConnection(query: ConnectorConnectionQuery): StoredConnectionEvent[] {
    const where: WhereClause & { status?: string } = buildWhere(query)
    if (query.status !== undefined) where.status = query.status

    const records = this.connection.getRecords({
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      where,
      order: "desc",
    })

    return records.map((record) => ({
      seq: record.seq,
      ts: record.ts,
      type: record.event.type,
      connectorId: record.event.connector_id,
      channelId: record.event.channel_id,
      status: statusOf(record.event.status),
      detail: record.event.detail,
    }))
  }

  close(): void {
    this.raw.close()
    this.processed.close()
    this.connection.close()
  }
}

const buildWhere = (query: ConnectorQuery): WhereClause => {
  const where: WhereClause = {}
  if (query.connectorId !== undefined) where.connector_id = query.connectorId
  if (query.channelId !== undefined) where.channel_id = query.channelId

  return where
}

// Narrow the stored string back to the union without `as`, validating against
// the same schema that defines the value set — no second list to keep in sync.
// An unknown value (a row written by a newer build, say) degrades to "error"
// rather than lying about the type.
const statusField = connectorConnectionEventSchema.shape.status

const statusOf = (value: string): ConnectorConnectionStatus => {
  const parsed = statusField.safeParse(value)

  return parsed.success ? parsed.data : "error"
}

const capPayload = (payload: string, type: string): string => {
  const size = Buffer.byteLength(payload, "utf8")
  if (size <= RAW_PAYLOAD_CAP) return payload

  return JSON.stringify({
    ...headFields(payload),
    _funnel_oversized: size,
    _funnel_type: type,
  })
}

// Keep the few keys that answer "what kind of event was this, when, where",
// so an oversized raw row is still useful for the timeline even though its
// body is gone. Any parse failure degrades to an empty object — the wrapper
// around it always produces valid JSON.
const HEAD_KEYS = ["type", "subtype", "ts", "channel", "channel_type", "user", "bot_id"]

const headFields = (payload: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed !== "object" || parsed === null) return {}

    const source = parsed as Record<string, unknown>
    const head: Record<string, unknown> = {}

    for (const key of HEAD_KEYS) {
      if (source[key] !== undefined) head[key] = source[key]
    }

    return head
  } catch {
    return {}
  }
}
