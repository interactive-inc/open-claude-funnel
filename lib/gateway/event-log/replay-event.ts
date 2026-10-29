import {
  funnelEventSchema,
  type FunnelEvent,
  type FunnelEventRecord,
} from "@/gateway/event-log/event-log"
import { replayRoutingMetadata } from "@/gateway/event-log/replay-routing"

/** Validate and detach replay data before either store can retain it. */
export function replayEventFromRecord(record: FunnelEventRecord): FunnelEvent {
  const meta = record.meta
  const exclusive = record.exclusive
  return parseReplayEvent({
    type: meta?.event_type ?? "unknown",
    content: record.content,
    channel_id: record.channelId,
    connector_id: record.connectorId,
    meta,
    ...(exclusive !== undefined ? { exclusive } : {}),
  })
}

export function parseReplayEvent(value: unknown): FunnelEvent {
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
  return {
    ...parsed.data,
    meta: replayRoutingMetadata(parsed.data.channel_id, parsed.data.connector_id, meta) ?? null,
    ...(exclusive ? { exclusive } : {}),
  }
}
