import { isNumberObject } from "node:util/types"

/** Reject numeric coercion to null before any external request can be dispatched. */
export function serializeJsonBody(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, entry: unknown) => {
    // JSON coerces boxed numbers after the replacer. Coerce once here so that
    // custom conversion cannot turn an unchecked value into null afterward.
    const converted = isNumberObject(entry) ? +entry : entry
    if (typeof converted === "number" && !Number.isFinite(converted))
      throw new TypeError("JSON body numbers must be finite")
    return converted
  })
  if (serialized === undefined) throw new TypeError("JSON body must be serializable")
  return serialized
}
