import { requireTimestamp } from "@/require-timestamp"

/** Validate and detach checkpoints at both sides of a host-owned state boundary. */
export function snapshotScheduleState(state: ReadonlyMap<string, Date>): Map<string, Date> {
  return new Map(
    Array.from(state, ([id, date]): [string, Date] => {
      try {
        return [id, new Date(requireTimestamp(date.getTime()))]
      } catch (error) {
        throw new RangeError("schedule checkpoint must be a valid timestamp", { cause: error })
      }
    }),
  )
}
