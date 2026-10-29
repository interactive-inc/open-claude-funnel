import { z } from "zod"
import type { ReplayableEvent } from "@/gateway/broadcaster"

/**
 * Replayable event payload persisted by the gateway. Domain events the
 * broadcaster emits to WS clients land here so reconnects across daemon
 * restarts can be served from disk. System events (gateway start, channel
 * connected, etc.) are routed to `FunnelLogger` instead — they never go
 * through this log, which keeps the offset space clean for replay.
 */
export const funnelEventSchema = z.object({
  type: z.string(),
  content: z.string(),
  channel_id: z.string().nullable(),
  connector_id: z.string().nullable(),
  meta: z.record(z.string(), z.string()).nullable(),
  exclusive: z.record(z.string(), z.string().nullable()).optional(),
})

export type FunnelEvent = z.infer<typeof funnelEventSchema>

/** One broadcast event to persist, carrying the offset the broadcaster assigned. */
export type FunnelEventRecord = {
  content: string
  /** Canonical routing identities; replay fills missing metadata and rejects conflicting IDs. */
  channelId: string | null
  connectorId: string | null
  meta: Record<string, string> | null
  /** Positive safe integer, unique among the store's retained records. */
  offset: number
  exclusive?: Record<string, string | null>
}

/**
 * Durable, append-only log of broadcaster events keyed by the offset the
 * broadcaster assigns. The gateway persists every domain event here, and
 * across restarts it both seeds the broadcaster's offset counter
 * (`findMaxOffset`) and serves reconnect replay (`loadSince`) from it.
 *
 * `loadSince` is the only method the broadcaster itself needs, which makes
 * any implementation assignable to the broadcaster's narrow `ReplaySource`.
 *
 * Implementations:
 *   - `SqliteFunnelEventLog` — optional host-selected durable storage.
 *   - `MemoryFunnelEventLog` — an in-process double for tests and embedders
 *     that do not need durability (replay is lost when the process exits).
 */
export abstract class FunnelEventLog {
  /** Complete synchronously or throw. Async implementations cannot be used for publication. */
  abstract record(record: FunnelEventRecord): void

  /**
   * Ascending offsets strictly after since. since and an explicit limit must
   * be non-negative safe integers. An omitted limit reads all retained rows;
   * zero returns no rows. Reject invalid bounds before reading any records.
   */
  abstract loadSince(since: number, limit?: number): ReplayableEvent[]

  /** Highest recorded offset, preserved after retention and clear remove payloads. */
  abstract findMaxOffset(): number

  /**
   * Atomically assign unclaimed work and return a boolean synchronously.
   * Invalid IDs/offsets or a different scoped channel return false; failures throw.
   */
  claimExclusive(_offset: number, _channelId: string, _subscriberId: string): boolean {
    return false
  }

  /** Drop every stored event and reclaim the file. The broadcaster's in-memory
   *  offset counter is unaffected, so offsets keep increasing after a clear. */
  abstract clear(): void

  abstract close(): void
}
