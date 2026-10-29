import type { ReplayableEvent } from "@/gateway/broadcaster"

/** Detach host-owned metadata and prevent observers from changing another delivery or replay. */
export function eventSnapshot(event: ReplayableEvent): ReplayableEvent {
  const { content, meta, offset, exclusive } = event
  return Object.freeze({
    content,
    meta: meta ? Object.freeze({ ...meta }) : undefined,
    offset,
    ...(exclusive ? { exclusive: Object.freeze({ ...exclusive }) } : {}),
  })
}
