import { z } from "zod"
import type { ReplayableEvent } from "@/gateway/broadcaster"
import { LeucoLoggerSqliteSink } from "@/logger/leuco-logger-sqlite-sink"

const MAX_CONTENT_CHARS = 2000

/**
 * Replayable event payload persisted by the gateway. Domain events the
 * broadcaster emits to WS clients land here so reconnects across daemon
 * restarts can be served from disk. System events (gateway start, channel
 * connected, etc.) are routed to `FunnelLogger` instead — they never go
 * through this store, which keeps the seq space clean for replay.
 */
export const funnelEventSchema = z.object({
  type: z.string(),
  content: z.string(),
  channel_id: z.string().nullable(),
  connector_id: z.string().nullable(),
  meta: z.record(z.string(), z.string()).nullable(),
})

export type FunnelEvent = z.infer<typeof funnelEventSchema>

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
 * SQLite-backed event store. One indexed table holds every broadcaster
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
export class FunnelEventStore {
  private readonly sink: LeucoLoggerSqliteSink<FunnelEvent, ["channel_id", "connector_id"]>
  private readonly now: () => number

  constructor(props: Props) {
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
  record(props: {
    content: string
    channelId: string | null
    connectorId: string | null
    meta: Record<string, string> | null
    offset: number
  }): void {
    const event: FunnelEvent = {
      type: props.meta?.event_type ?? "unknown",
      content: truncate(props.content),
      channel_id: props.channelId,
      connector_id: props.connectorId,
      meta: props.meta,
    }
    this.sink.write({ seq: props.offset, ts: this.now(), event })
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
