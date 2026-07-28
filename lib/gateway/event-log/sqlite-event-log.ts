import type { ReplayableEvent } from "@/gateway/broadcaster"
import { FunnelLogger } from "@/engine/logger/logger"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import {
  type FunnelEvent,
  FunnelEventLog,
  type FunnelEventRecord,
} from "@/gateway/event-log/event-log"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"

const MAX_CONTENT_CHARS = 2000

type Props = {
  /** SQLite database file path. Created on first write. ":memory:" for tests. */
  path: string
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number
  /** Surfaces a failed persist (PK collision, disk-full, locked WAL). Silent if absent. */
  logger?: FunnelLogger
  /**
   * Host-supplied error sink. Routed alongside the logger when a write
   * fails, so Sentry / Datadog / a custom alert pipeline sees the durable
   * replay loss too — not just the local log file. Silent if absent.
   */
  onError?: OnFunnelError
  /** Optional row cap. Pruned on every insert. */
  maxRows?: number
  /** Optional age cap in ms. Pruned on every insert. */
  maxAgeMs?: number
  /** Optional on-disk byte cap. Checked periodically; on overflow the oldest rows are dropped toward targetBytes and the file is VACUUMed. */
  maxBytes?: number
  /** Shrink target when maxBytes is exceeded. Defaults to maxBytes/4. */
  targetBytes?: number
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
  private readonly sink: SqliteEventLog<FunnelEvent, ["channel_id", "connector_id"]>
  private readonly now: () => number
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError | undefined

  constructor(props: Props) {
    super()
    this.now = props.now ?? (() => Date.now())
    this.logger = props.logger
    this.onError = props.onError
    this.sink = new SqliteEventLog<FunnelEvent, ["channel_id", "connector_id"]>({
      path: props.path,
      indexes: ["channel_id", "connector_id"],
      extractIndexes: (event) => ({
        channel_id: event.channel_id,
        connector_id: event.connector_id,
      }),
      now: this.now,
      ...(props.maxRows !== undefined ? { maxRows: props.maxRows } : {}),
      ...(props.maxAgeMs !== undefined ? { maxAgeMs: props.maxAgeMs } : {}),
      ...(props.maxBytes !== undefined ? { maxBytes: props.maxBytes } : {}),
      ...(props.targetBytes !== undefined ? { targetBytes: props.targetBytes } : {}),
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
    const result = this.sink.write({ seq: record.offset, ts: this.now(), event })

    // A dropped write (PK collision on a reused offset, disk-full, locked WAL)
    // silently loses the event from durable replay. Surface it to the local
    // log AND through the host's error sink so off-box alerting (Sentry /
    // Datadog) sees the loss too — discarding the Error the sink returns
    // would mean the operator only sees missing replay rows after the fact.
    if (result instanceof Error) {
      this.logger?.error("event log write failed", {
        offset: record.offset,
        error: result.message,
      })
      this.onError?.(result, {
        component: "sqlite-event-log",
        op: "record",
        offset: record.offset,
        channelId: record.channelId,
        connectorId: record.connectorId,
      })
    }
  }

  /**
   * Returns events with offset > since. Filtering by channel/connector is
   * the broadcaster's responsibility (it knows the client's subscription),
   * so this returns the full slice and lets the caller filter.
   */
  loadSince(since: number): ReplayableEvent[] {
    const records = this.sink.query({ sinceSeq: since, limit: Number.MAX_SAFE_INTEGER })
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

    const records = this.sink.query({
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

  clear(): void {
    this.sink.clear()
  }

  close(): void {
    this.sink.close()
  }
}

function truncate(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) return content
  return `${content.slice(0, MAX_CONTENT_CHARS)}...`
}
