import type { ReplayableEvent } from "@/gateway/broadcaster"
import {
  type FunnelEvent,
  FunnelEventLog,
  type FunnelEventRecord,
} from "@/gateway/funnel-event-log"
import { LeucoLoggerSqliteSink } from "@/logger/leuco-logger-sqlite-sink"

const MAX_CONTENT_CHARS = 2000

type Props = {
  /** SQLite database file path. Created on first write. ":memory:" for tests. */
  path: string
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number
  /** Optional row cap. Pruned on every insert. */
  maxRows?: number
  /** Optional age cap in ms. Pruned on every insert. */
  maxAgeMs?: number
}

/**
 * SQLite-backed `FunnelEventLog`. One indexed table holds every broadcaster
 * event with `channel_id` and `connector_id` as dedicated columns, so
 * per-channel and per-connector replay is an indexed range scan.
 *
 * Concurrency: `seq` is `INTEGER PRIMARY KEY`, so SQLite assigns it
 * atomically. The broadcaster owns its own offset counter at runtime
 * (seeded from `findMaxOffset()` at startup); each broadcaster event
 * flows in here via `record()` with that pre-assigned offset, which the
 * sink stores via `write()` — PK uniqueness catches double-emit bugs.
 *
 * System events (gateway lifecycle, channel connect/disconnect, etc.) do
 * NOT go through this store. They are diagnostic only and live in
 * `FunnelLogger`'s file so the seq space here stays exclusive to
 * broadcaster traffic. This is what makes the broadcaster's seq seeding
 * (`getMaxSeq()` at startup) correct without per-event coordination.
 */
export class SqliteFunnelEventLog extends FunnelEventLog {
  private readonly sink: LeucoLoggerSqliteSink<FunnelEvent, ["channel_id", "connector_id"]>
  private readonly now: () => number

  constructor(props: Props) {
    super()
    this.now = props.now ?? (() => Date.now())
    this.sink = new LeucoLoggerSqliteSink<FunnelEvent, ["channel_id", "connector_id"]>({
      path: props.path,
      indexes: ["channel_id", "connector_id"],
      extractIndexes: (event) => ({
        channel_id: event.channel_id,
        connector_id: event.connector_id,
      }),
      now: this.now,
      ...(props.maxRows !== undefined ? { maxRows: props.maxRows } : {}),
      ...(props.maxAgeMs !== undefined ? { maxAgeMs: props.maxAgeMs } : {}),
    })
  }

  /**
   * Persist a broadcaster-driven event with its assigned offset. Caller
   * (the gateway-server) supplies the offset from `broadcaster.broadcast()`
   * so this store and the broadcaster's in-memory ring stay aligned.
   */
  record(record: FunnelEventRecord): void {
    const event: FunnelEvent = {
      type: record.meta?.event_type ?? "unknown",
      content: truncate(record.content),
      channel_id: record.channelId,
      connector_id: record.connectorId,
      meta: record.meta,
    }
    this.sink.write({ seq: record.offset, ts: this.now(), event })
  }

  /**
   * Returns events with offset > since. Filtering by channel/connector is
   * the broadcaster's responsibility (it knows the client's subscription),
   * so this returns the full slice and lets the caller filter.
   */
  loadSince(since: number): ReplayableEvent[] {
    const records = this.sink.getRecords({ sinceSeq: since })
    const out: ReplayableEvent[] = []
    for (const record of records) {
      out.push({
        content: record.event.content,
        meta: record.event.meta ?? undefined,
        offset: record.seq,
      })
    }
    return out
  }

  /**
   * Returns events for one channel (and optionally one connector). Used
   * by the gateway logs CLI for scoped queries. Channel/connector filters
   * are indexed columns, so this is an indexed range scan.
   */
  loadForChannel(props: {
    channelId: string
    connectorId?: string
    sinceSeq?: number
    limit?: number
  }): ReplayableEvent[] {
    const where: { channel_id: string; connector_id?: string } = {
      channel_id: props.channelId,
    }
    if (props.connectorId !== undefined) where.connector_id = props.connectorId

    const records = this.sink.getRecords({
      where,
      ...(props.sinceSeq !== undefined ? { sinceSeq: props.sinceSeq } : {}),
      ...(props.limit !== undefined ? { limit: props.limit } : {}),
    })
    const out: ReplayableEvent[] = []
    for (const record of records) {
      out.push({
        content: record.event.content,
        meta: record.event.meta ?? undefined,
        offset: record.seq,
      })
    }
    return out
  }

  findMaxOffset(): number {
    return this.sink.getMaxSeq()
  }

  close(): void {
    this.sink.close()
  }
}

function truncate(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) return content
  return `${content.slice(0, MAX_CONTENT_CHARS)}...`
}
