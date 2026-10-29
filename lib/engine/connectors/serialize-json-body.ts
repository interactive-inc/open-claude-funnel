/** Reject numeric coercion to null before any external request can be dispatched. */
export function serializeJsonBody(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === "number" && !Number.isFinite(entry))
      throw new TypeError("JSON body numbers must be finite")
    return entry
  })
  if (serialized === undefined) throw new TypeError("JSON body must be serializable")
  return serialized
}
