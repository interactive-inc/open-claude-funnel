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
})

export type FunnelEvent = z.infer<typeof funnelEventSchema>

/** One broadcast event to persist, carrying the offset the broadcaster assigned. */
export type FunnelEventRecord = {
  content: string
  channelId: string | null
  connectorId: string | null
  meta: Record<string, string> | null
  offset: number
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
 *   - `SqliteFunnelEventLog` — the default; durable across daemon restarts.
 *   - `MemoryFunnelEventLog` — an in-process double for tests and embedders
 *     that do not need durability (replay is lost when the process exits).
 */
export abstract class FunnelEventLog {
  abstract record(record: FunnelEventRecord): void

  abstract loadSince(since: number): ReplayableEvent[]

  abstract findMaxOffset(): number

  abstract close(): void
}
