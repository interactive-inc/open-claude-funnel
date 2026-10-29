import {
  funnelEventSchema,
  type FunnelEvent,
  type FunnelEventRecord,
} from "@/gateway/event-log/event-log"
import { replayRoutingMetadata } from "@/gateway/event-log/replay-routing"

/** Validate and detach replay data before either store can retain it. */
export function replayEventFromRecord(record: FunnelEventRecord): FunnelEvent {
  const meta = snapshotDictionary(record.meta)
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
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("replay event data is invalid")
  const {
    type,
    content,
    channel_id,
    connector_id,
    meta: suppliedMeta,
    exclusive: suppliedExclusive,
  } = value as FunnelEvent
  const snapshot = {
    type,
    content,
    channel_id,
    connector_id,
    meta: snapshotDictionary(suppliedMeta),
    exclusive: snapshotDictionary(suppliedExclusive),
  }
  const parsed = funnelEventSchema.safeParse(snapshot)
  if (!parsed.success) throw new Error("replay event data is invalid")
  // Zod record outputs omit __proto__. Preserve every own key and validate
  // the copied values too, including keys skipped by the record parser.
  const meta = snapshot.meta === null ? null : { ...snapshot.meta }
  const exclusive = snapshot.exclusive ? { ...snapshot.exclusive } : undefined
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

/** Preserve prototypes for schema validation while capturing enumerable own values. */
function snapshotDictionary<T>(value: T): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value
  return Object.setPrototypeOf({ ...value }, Object.getPrototypeOf(value))
}
