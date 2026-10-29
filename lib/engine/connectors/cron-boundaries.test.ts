import { expect, test } from "bun:test"
import { matchCron, validateCronExpression } from "@/engine/connectors/match-cron"
import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"

const invalid = [
  "/5 * * * *",
  "-5 * * * *",
  "0- * * * *",
  "+5 * * * *",
  "0xA * * * *",
  "1e1 * * * *",
  "5.0 * * * *",
  "*/0x2 * * * *",
  "*/1e1 * * * *",
  "0-0xA * * * *",
]

test("cron values, range endpoints and steps cannot use JavaScript numeric coercions", () => {
  for (const expression of invalid) {
    expect(() => validateCronExpression(expression)).toThrow()
    expect(() => matchCron(expression, new Date(2026, 0, 1))).toThrow()
  }
})

test("wildcard day-of-month steps still require both the selected date and weekday", () => {
  expect(matchCron("0 9 */2 * 3", new Date(2026, 3, 22, 9))).toBe(false)
  expect(matchCron("0 9 */2 * 3", new Date(2026, 3, 23, 9))).toBe(false)
  expect(matchCron("0 9 */2 * 3", new Date(2026, 3, 29, 9))).toBe(true)
})

test("wildcard weekday steps do not replace the requested day-of-month", () => {
  expect(matchCron("0 9 1 * */2", new Date(2026, 4, 3, 9))).toBe(false)
  expect(matchCron("0 9 1 * */2", new Date(2026, 5, 1, 9))).toBe(false)
  expect(matchCron("0 9 1 * */2", new Date(2026, 10, 1, 9))).toBe(true)
})

test("wildcard syntax determines day matching even for lists and equivalent ranges", () => {
  const thursday = new Date(2026, 3, 23, 9)
  expect(matchCron("0 9 *,1 * 3", thursday)).toBe(false)
  expect(matchCron("0 9 1,* * 3", thursday)).toBe(true)
  expect(matchCron("0 9 1-31 * 3", thursday)).toBe(true)
  expect(matchCron("00 09 * * 3", new Date(2026, 3, 22, 9))).toBe(true)
  expect(matchCron("0/15 9 * * *", new Date(2026, 3, 23, 9, 30))).toBe(true)
})

test("unsupported numeric spellings fail through schedule creation without persisting entries", () => {
  const funnel = new Funnel({ connectors: [scheduleConnector()], channels: [{ name: "ops" }] })
  funnel.channels.addConnector("ops", { type: "schedule", name: "timer" })
  for (const cron of invalid) {
    expect(() =>
      funnel.channels.connectorOp("ops", "timer", "addEntry", { cron, prompt: "entry" }),
    ).toThrow()
    expect(funnel.channels.connectorOp("ops", "timer", "listEntries", {})).toEqual([])
  }
})
