/** Validate an injected millisecond timestamp before it can affect runtime state. */
export function requireTimestamp(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(new Date(value).getTime()))
    throw new RangeError("time must be a valid timestamp")
  return value
}
