import { isNumberObject } from "node:util/types"
import { requireSynchronous } from "@/require-synchronous"

/** Serialize synchronous JSON values without coercing non-finite numbers to null. */
export function serializeJsonBody(value: unknown, onError?: (error: unknown) => unknown): string {
  const serialized = JSON.stringify(value, (_key, entry: unknown) => {
    requireSynchronous(entry, "JSON body values must be synchronous", onError)
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
