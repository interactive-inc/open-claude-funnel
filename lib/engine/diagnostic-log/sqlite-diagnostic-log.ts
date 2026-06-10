import { chmodSync } from "node:fs"
import type { FunnelLogEntry } from "@/logger/funnel-log-entry"
import { FunnelLogger } from "@/engine/logger/logger"
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
} from "@/engine/diagnostic-log/diagnostic-log"
import { FunnelLogSqliteSink } from "@/logger/funnel-log-sqlite-sink"

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
  /** Row cap for the processed and connection tables. Pruned on every insert. */
  maxRows?: number
  /**
   * Row cap for the raw table specifically. Raw rows can each hold up to
   * `RAW_PAYLOAD_CAP` bytes, so they want a tighter cap than the small
   * processed/connection verdict rows. Defaults to `maxRows` when unset.
   */
  rawMaxRows?: number
  /** Age cap in ms for all tables — bounds how long untouched payloads (with PII) live. Pruned on every insert. */
  maxAgeMs?: number
  /** When set, `insert()` errors (disk full, WAL lock) are logged instead of silently dropped. */
  logger?: FunnelLogger
}

type WhereClause = { connector_id?: string | null; channel_id?: string | null }

/**
 * Default `ConnectorDiagnosticLog`: three independent `FunnelLogSqliteSink`s, one
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
  private readonly raw: FunnelLogSqliteSink<ConnectorRawEvent, RawIndexes>
  private readonly processed: FunnelLogSqliteSink<ConnectorProcessedEvent, ProcessedIndexes>
  private readonly connection: FunnelLogSqliteSink<ConnectorConnectionEvent, ConnectionIndexes>
  private readonly now: () => number
  private readonly logger: FunnelLogger | undefined

  constructor(props: Props) {
    super()
    this.now = props.now ?? (() => Date.now())
    this.logger = props.logger
    const ageCap = props.maxAgeMs !== undefined ? { maxAgeMs: props.maxAgeMs } : {}
    const verdictCap = {
      now: this.now,
      ...ageCap,
      ...(props.maxRows !== undefined ? { maxRows: props.maxRows } : {}),
    }
    const rawMax = props.rawMaxRows ?? props.maxRows
    const rawCap = {
      now: this.now,
      ...ageCap,
      ...(rawMax !== undefined ? { maxRows: rawMax } : {}),
    }
    this.raw = new FunnelLogSqliteSink<ConnectorRawEvent, RawIndexes>({
      path: props.rawPath,
      indexes: ["event_id", "connector_id", "channel_id"],
      extractIndexes: (event) => ({
        event_id: event.event_id,
        connector_id: event.connector_id,
        channel_id: event.channel_id,
      }),
      ...rawCap,
    })
    this.processed = new FunnelLogSqliteSink<ConnectorProcessedEvent, ProcessedIndexes>({
      path: props.processedPath,
      indexes: ["event_id", "connector_id", "channel_id", "outcome"],
      extractIndexes: (event) => ({
        event_id: event.event_id,
        connector_id: event.connector_id,
        channel_id: event.channel_id,
        outcome: event.outcome,
      }),
      ...verdictCap,
    })
    this.connection = new FunnelLogSqliteSink<ConnectorConnectionEvent, ConnectionIndexes>({
      path: props.connectionPath,
      indexes: ["connector_id", "channel_id", "status"],
      extractIndexes: (event) => ({
        connector_id: event.connector_id,
        channel_id: event.channel_id,
        status: event.status,
      }),
      ...verdictCap,
    })

    // These files hold untouched inbound payloads (Slack message text, user
    // ids). On a shared host /tmp is world-traversable, so lock the files to
    // the owner — same posture as the gateway token file.
    restrictPermissions(props.rawPath)
    restrictPermissions(props.processedPath)
    restrictPermissions(props.connectionPath)

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
    this.report("raw", this.raw.insert({ ts: this.now(), event }))
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
    this.report("processed", this.processed.insert({ ts: this.now(), event }))
  }

  recordConnection(record: ConnectorConnectionRecord): void {
    const event: ConnectorConnectionEvent = {
      type: record.type,
      connector_id: record.connectorId,
      channel_id: record.channelId,
      status: record.status,
      detail: record.detail,
    }
    this.report("connection", this.connection.insert({ ts: this.now(), event }))
  }

  // A diagnostic store that swallows its own write failures is the one thing
  // it must not do: surface the error so a disk-full or locked WAL is visible.
  private report(table: string, result: FunnelLogEntry<unknown> | Error): void {
    if (result instanceof Error) {
      this.logger?.error("diagnostic log insert failed", { table, error: result.message })
    }
  }

  queryRaw(query: ConnectorRawQuery): StoredRawEvent[] {
    const records = this.raw.query({
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

    const records = this.processed.query({
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

    const records = this.connection.query({
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

  clear(): void {
    this.raw.clear()
    this.processed.clear()
    this.connection.clear()
  }

  close(): void {
    this.raw.close()
    this.processed.close()
    this.connection.close()
  }
}

// Lock a freshly-opened db file (and its WAL sidecars) to the owner. ":memory:"
// has no file; a chmod failure (already gone, unusual FS) is non-fatal — the
// store still works, it just isn't hardened, so we swallow rather than crash.
const restrictPermissions = (path: string): void => {
  if (path === ":memory:") return

  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      chmodSync(`${path}${suffix}`, 0o600)
    } catch {
      // sidecar may not exist yet, or FS may not support chmod — ignore
    }
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
