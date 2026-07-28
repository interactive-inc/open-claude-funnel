import { describe, expect, test } from "bun:test"
import {
  scheduleEntryInputSchema,
  scheduleEntrySchema,
} from "@/engine/connectors/schedule-connector-schema"

describe("scheduleEntrySchema", () => {
  test("keeps legacy cron entries compatible and assigns kind", () => {
    const entry = scheduleEntrySchema.parse({
      id: "daily",
      cron: "0 9 * * 1-5",
      prompt: "standup",
    })

    expect(entry.kind).toBe("cron")
  })

  test("rejects an invalid cron before listener startup", () => {
    const result = scheduleEntrySchema.safeParse({
      id: "bad",
      cron: "60 * * * *",
      prompt: "never",
    })

    expect(result.success).toBe(false)
  })

  test("accepts a native one-shot entry with an offset datetime", () => {
    const entry = scheduleEntrySchema.parse({
      id: "once",
      kind: "once",
      runAt: "2026-08-01T09:00:00+09:00",
      prompt: "one time",
    })

    expect(entry.kind).toBe("once")
  })

  test("entry input requires exactly one schedule form", () => {
    const neither = scheduleEntryInputSchema.safeParse({ prompt: "missing" })
    const both = scheduleEntryInputSchema.safeParse({
      cron: "* * * * *",
      runAt: "2026-08-01T00:00:00Z",
      prompt: "ambiguous",
    })

    expect(neither.success).toBe(false)
    expect(both.success).toBe(false)
  })
})
