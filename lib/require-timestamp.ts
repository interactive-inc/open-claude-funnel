import { requireSynchronous } from "@/require-synchronous"

/** Validate an injected millisecond timestamp before it can affect runtime state. */
export function requireTimestamp(value: number): number {
  requireSynchronous(value, "time must be synchronous")
  if (!Number.isFinite(value) || Number.isNaN(new Date(value).getTime()))
    throw new RangeError("time must be a valid timestamp")
  return value
}
