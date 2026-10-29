import { requireTimestamp } from "@/require-timestamp"

/** Validate and detach checkpoints at both sides of a host-owned state boundary. */
export function snapshotScheduleState(state: ReadonlyMap<string, Date>): Map<string, Date> {
  const iterator = typeof state === "object" && state !== null ? state[Symbol.iterator] : undefined
  if (typeof iterator !== "function") throw new TypeError("schedule state must be an iterable map")
  return new Map(
    Array.from({ [Symbol.iterator]: () => iterator.call(state) }, ([id, date]): [string, Date] => {
      try {
        return [id, new Date(requireTimestamp(date.getTime()))]
      } catch (error) {
        throw new RangeError("schedule checkpoint must be a valid timestamp", { cause: error })
      }
    }),
  )
}
