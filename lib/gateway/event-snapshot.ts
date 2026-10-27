import type { ReplayableEvent } from "@/gateway/broadcaster"

/** Detach host-owned metadata and prevent observers from changing another delivery or replay. */
export function eventSnapshot(event: ReplayableEvent): ReplayableEvent {
  return Object.freeze({
    content: event.content,
    meta: event.meta ? Object.freeze({ ...event.meta }) : undefined,
    offset: event.offset,
    ...(event.exclusive ? { exclusive: Object.freeze({ ...event.exclusive }) } : {}),
  })
}
