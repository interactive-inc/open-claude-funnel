import { describe, expect, test } from "bun:test"
import { matchCron } from "@/modules/connectors/match-cron"

describe("matchCron", () => {
  test("wildcard matches any minute", () => {
    expect(matchCron("* * * * *", new Date(2026, 0, 1, 0, 0))).toBe(true)
    expect(matchCron("* * * * *", new Date(2026, 11, 31, 23, 59))).toBe(true)
  })

  test("exact minute match", () => {
    expect(matchCron("15 * * * *", new Date(2026, 0, 1, 10, 15))).toBe(true)
    expect(matchCron("15 * * * *", new Date(2026, 0, 1, 10, 14))).toBe(false)
  })

  test("step expression */5 matches every 5 minutes", () => {
    expect(matchCron("*/5 * * * *", new Date(2026, 0, 1, 10, 0))).toBe(true)
    expect(matchCron("*/5 * * * *", new Date(2026, 0, 1, 10, 5))).toBe(true)
    expect(matchCron("*/5 * * * *", new Date(2026, 0, 1, 10, 6))).toBe(false)
  })

  test("range with step", () => {
    expect(matchCron("0-30/10 * * * *", new Date(2026, 0, 1, 10, 20))).toBe(true)
    expect(matchCron("0-30/10 * * * *", new Date(2026, 0, 1, 10, 25))).toBe(false)
    expect(matchCron("0-30/10 * * * *", new Date(2026, 0, 1, 10, 40))).toBe(false)
  })

  test("list expression", () => {
    expect(matchCron("0,15,30,45 * * * *", new Date(2026, 0, 1, 10, 30))).toBe(true)
    expect(matchCron("0,15,30,45 * * * *", new Date(2026, 0, 1, 10, 31))).toBe(false)
  })

  test("weekday range", () => {
    // 2026-04-22 is a Wednesday (day 3)
    expect(matchCron("0 9 * * 1-5", new Date(2026, 3, 22, 9, 0))).toBe(true)
    // 2026-04-25 is a Saturday (day 6)
    expect(matchCron("0 9 * * 1-5", new Date(2026, 3, 25, 9, 0))).toBe(false)
  })

  test("invalid arity throws", () => {
    expect(() => matchCron("* * *", new Date())).toThrow(/5 fields/)
  })

  test("out-of-range throws", () => {
    expect(() => matchCron("60 * * * *", new Date())).toThrow(/out of range/)
  })
})
