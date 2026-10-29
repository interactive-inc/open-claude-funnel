import type { ReplayableEvent } from "@/gateway/broadcaster"
import { FunnelLogger } from "@/engine/logger/logger"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import {
  type FunnelEvent,
  FunnelEventLog,
  funnelEventSchema,
  type FunnelEventRecord,
} from "@/gateway/event-log/event-log"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteExclusiveClaims } from "@/gateway/event-log/sqlite-exclusive-claims"
import { eventSnapshot } from "@/gateway/event-snapshot"
import { invokeCallback } from "@/invoke-callback"

type Props = {
  /** SQLite database file path. Created on first write. ":memory:" for tests. */
  path: string
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number
  /** Reports a failed persist (PK collision, disk-full, locked WAL) before record() throws. */
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
 * The broadcaster owns its own offset counter at runtime
 * (seeded from `findMaxOffset()` at startup); each broadcaster event
 * flows in here via `record()` with that pre-assigned offset, which the
 * sink stores via `write()` together with a durable high watermark. PK
 * uniqueness catches collisions with retained rows; one broadcaster owns
 * offset assignment for a store.
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
  private readonly exclusiveClaims: SqliteExclusiveClaims
  private readonly hasRetention: boolean

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
      onMaintenanceError: (error) => this.reportMaintenanceError(error, "compact"),
      ...(props.maxRows !== undefined ? { maxRows: props.maxRows } : {}),
      ...(props.maxAgeMs !== undefined ? { maxAgeMs: props.maxAgeMs } : {}),
      ...(props.maxBytes !== undefined ? { maxBytes: props.maxBytes } : {}),
      ...(props.targetBytes !== undefined ? { targetBytes: props.targetBytes } : {}),
    })
    try {
      this.exclusiveClaims = new SqliteExclusiveClaims(props.path)
    } catch (error) {
      this.sink.close()
      throw error
    }
    this.hasRetention =
      props.maxRows !== undefined || props.maxAgeMs !== undefined || props.maxBytes !== undefined
  }

  /**
   * Persist a broadcaster-driven event with its assigned offset. Caller
   * (the gateway-server) supplies the offset from `broadcaster.broadcast()`
   * so this store and the broadcaster's in-memory ring stay aligned.
   */
  record(record: FunnelEventRecord): void {
    const event: FunnelEvent = {
      type: record.meta?.event_type ?? "unknown",
      content: record.content,
      channel_id: record.channelId,
      connector_id: record.connectorId,
      meta: record.meta,
      ...(record.exclusive ? { exclusive: record.exclusive } : {}),
    }
    let result: Error | void
    try {
      result = this.sink.write({
        seq: record.offset,
        ts: this.now(),
        event: this.parseEvent(event),
      })
    } catch (error) {
      result = error instanceof Error ? error : new Error(String(error))
    }

    if (this.hasRetention && !(result instanceof Error)) {
      try {
        const oldest = this.sink.query({ limit: 1 })[0]?.seq
        if (oldest === undefined) this.exclusiveClaims.clear()
        else this.exclusiveClaims.pruneBefore(oldest)
      } catch (error) {
        this.reportMaintenanceError(error, "prune-claims")
      }
    }

    // A dropped write (PK collision on a reused offset, disk-full, locked WAL)
    // silently loses the event from durable replay. Surface it to the local
    // log AND through the host's error sink so off-box alerting (Sentry /
    // Datadog) sees the loss too — discarding the Error the sink returns
    // would mean the operator only sees missing replay rows after the fact.
    if (result instanceof Error) {
      invokeCallback(() =>
        this.logger?.error("event log write failed", {
          offset: record.offset,
          error: result.message,
        }),
      )
      invokeCallback(() =>
        this.onError?.(result, {
          component: "sqlite-event-log",
          op: "record",
          offset: record.offset,
          channelId: record.channelId,
          connectorId: record.connectorId,
        }),
      )
      throw result
    }
  }

  private reportMaintenanceError(error: unknown, op: "compact" | "prune-claims"): void {
    const failure = error instanceof Error ? error : new Error(String(error))
    invokeCallback(() =>
      this.logger?.error("event log maintenance failed", { op, error: failure.message }),
    )
    invokeCallback(() => this.onError?.(failure, { component: "sqlite-event-log", op }))
  }

  /**
   * Returns events with offset > since. Filtering by channel/connector is
   * the broadcaster's responsibility (it knows the client's subscription),
   * so this returns the full slice and lets the caller filter.
   */
  loadSince(since: number, limit = Number.MAX_SAFE_INTEGER): ReplayableEvent[] {
    const records = this.sink.query({ sinceSeq: since, limit })
    return records.map((record) => this.toReplay(record.seq, record.event))
  }

  /**
   * Returns events for one channel (and optionally one connector). Hosts
   * can use this for scoped queries. Channel/connector filters
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
    return records.map((record) => this.toReplay(record.seq, record.event))
  }

  findMaxOffset(): number {
    return this.sink.getMaxSeq()
  }

  override claimExclusive(offset: number, channelId: string, subscriberId: string): boolean {
    const stored = this.sink.query({ seq: offset, limit: 1 })[0]
    if (!stored) return false
    const event = this.parseEvent(stored.event)
    const assigned =
      event.exclusive && Object.hasOwn(event.exclusive, channelId)
        ? event.exclusive[channelId]
        : undefined

    if (assigned === undefined) return false
    if (assigned !== null) return assigned === subscriberId

    return this.exclusiveClaims.claim(offset, channelId, subscriberId)
  }

  private parseEvent(value: unknown): FunnelEvent {
    const parsed = funnelEventSchema.safeParse(value)
    if (!parsed.success) throw new Error("replay event data is invalid")
    // Zod record outputs omit __proto__. Preserve every own key and validate
    // the copied values too, including keys skipped by the record parser.
    const original = value as FunnelEvent
    const meta = original.meta === null ? null : { ...original.meta }
    const exclusive = original.exclusive ? { ...original.exclusive } : undefined
    if (
      Object.values(meta ?? {}).some((item) => typeof item !== "string") ||
      Object.values(exclusive ?? {}).some((item) => item !== null && typeof item !== "string")
    )
      throw new Error("replay event data is invalid")
    return { ...parsed.data, meta, ...(exclusive ? { exclusive } : {}) }
  }

  private toReplay(offset: number, value: unknown): ReplayableEvent {
    const event = this.parseEvent(value)
    return eventSnapshot({
      content: event.content,
      meta: event.meta ?? undefined,
      offset,
      ...(event.exclusive ? { exclusive: event.exclusive } : {}),
    })
  }

  clear(): void {
    this.sink.clear()
    this.exclusiveClaims.clear()
  }

  close(): void {
    this.sink.close()
    this.exclusiveClaims.close()
  }
}
