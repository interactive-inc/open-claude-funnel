import type { ReplayableEvent } from "@/gateway/broadcaster"
import { errorMessageOf, normalizeError } from "@/engine/error/error-message-of"
import { FunnelLogger } from "@/engine/logger/logger"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import {
  type FunnelEvent,
  FunnelEventLog,
  type FunnelEventRecord,
} from "@/gateway/event-log/event-log"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteExclusiveClaims } from "@/gateway/event-log/sqlite-exclusive-claims"
import { eventSnapshot } from "@/gateway/event-snapshot"
import { invokeCallback } from "@/invoke-callback"
import { parseReplayEvent, replayEventFromRecord } from "@/gateway/event-log/replay-event"
import { isValidExclusiveClaim } from "@/gateway/event-log/exclusive-claim"

type Props = {
  /**
   * OS file path opened or created during construction. ":memory:" for tests.
   * Empty paths, null bytes and SQLite URI filenames are rejected before file operations.
   */
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
 * NOT go through this store. They belong to the host's diagnostic logger,
 * so this store's offset space stays exclusive to broadcaster traffic.
 * The broadcaster seeds its startup offset from the store's high watermark.
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
    const { path, now, logger, onError, maxRows, maxAgeMs, maxBytes, targetBytes } = props
    this.now = now ?? (() => Date.now())
    this.logger = logger
    this.onError = onError
    this.sink = new SqliteEventLog<FunnelEvent, ["channel_id", "connector_id"]>({
      path,
      indexes: ["channel_id", "connector_id"],
      extractIndexes: (event) => ({
        channel_id: event.channel_id,
        connector_id: event.connector_id,
      }),
      now: this.now,
      onMaintenanceError: (error) => this.reportMaintenanceError(error, "compact"),
      ...(maxRows !== undefined ? { maxRows } : {}),
      ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      ...(targetBytes !== undefined ? { targetBytes } : {}),
    })
    try {
      this.exclusiveClaims = new SqliteExclusiveClaims(this.sink.database)
    } catch (error) {
      this.sink.close()
      throw error
    }
    this.hasRetention = maxRows !== undefined || maxAgeMs !== undefined || maxBytes !== undefined
  }

  /**
   * Persist a broadcaster-driven event with its assigned offset. Caller
   * (the gateway-server) supplies the offset from `broadcaster.broadcast()`
   * so this store and the broadcaster's in-memory ring stay aligned.
   */
  record(record: FunnelEventRecord): void {
    let result: Error | void
    try {
      result = this.sink.write({
        seq: record.offset,
        ts: this.now(),
        event: replayEventFromRecord(record),
      })
    } catch (error) {
      result = normalizeError(error)
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
          error: errorMessageOf(result),
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
    const failure = normalizeError(error)
    invokeCallback(() =>
      this.logger?.error("event log maintenance failed", { op, error: errorMessageOf(failure) }),
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
    const { channelId, connectorId, sinceSeq, limit } = props
    const where: { channel_id: string; connector_id?: string } = {
      channel_id: channelId,
    }
    if (connectorId !== undefined) where.connector_id = connectorId

    const records = this.sink.query({
      where,
      ...(sinceSeq !== undefined ? { sinceSeq } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })
    return records.map((record) => {
      const event = this.toReplay(record.seq, record.event)
      if (
        event.meta?.channelId !== channelId ||
        (connectorId !== undefined && event.meta?.connectorId !== connectorId)
      )
        throw new Error("replay routing index conflicts with stored identity")
      return event
    })
  }

  findMaxOffset(): number {
    return this.sink.getMaxSeq()
  }

  override claimExclusive(offset: number, channelId: string, subscriberId: string): boolean {
    if (!isValidExclusiveClaim(offset, channelId, subscriberId)) return false
    this.sink.requireIdleWriter()
    const stored = this.sink.query({ seq: offset, limit: 1 })[0]
    if (!stored) return false
    const event = parseReplayEvent(stored.event)
    if (event.channel_id !== null && event.channel_id !== channelId) return false
    const assigned =
      event.exclusive && Object.hasOwn(event.exclusive, channelId)
        ? event.exclusive[channelId]
        : undefined

    if (assigned === undefined) return false
    if (assigned !== null) return assigned === subscriberId

    return this.exclusiveClaims.claim(offset, channelId, subscriberId)
  }

  private toReplay(offset: number, value: unknown): ReplayableEvent {
    const event = parseReplayEvent(value)
    return eventSnapshot({
      content: event.content,
      meta: event.meta ?? undefined,
      offset,
      ...(event.exclusive ? { exclusive: event.exclusive } : {}),
    })
  }

  clear(): void {
    this.sink.clear()
  }

  close(): void {
    this.sink.close()
  }
}
