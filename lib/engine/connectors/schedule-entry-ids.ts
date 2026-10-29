export const DUPLICATE_SCHEDULE_ENTRY_ID = "schedule entry IDs must be unique"

/** Each entry owns exactly one checkpoint key within its connector. */
export function hasUniqueScheduleEntryIds(entries: ReadonlyArray<{ id: string }>): boolean {
  return new Set(entries.map((entry) => entry.id)).size === entries.length
}
