import { describe, expect, test, mock } from "bun:test"
import { nextFocusIndex } from "@/tui/components/ui/hascii/focus-group"

mock.module("@opentui/react", () => ({
  useKeyboard: () => undefined,
}))

describe("nextFocusIndex", () => {
  test("advances forward by one", () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1)
    expect(nextFocusIndex(1, 3, false)).toBe(2)
  })

  test("steps backward by one when shift is held", () => {
    expect(nextFocusIndex(2, 3, true)).toBe(1)
    expect(nextFocusIndex(1, 3, true)).toBe(0)
  })

  test("wraps from the last index forward to the first", () => {
    expect(nextFocusIndex(2, 3, false)).toBe(0)
  })

  test("wraps from the first index backward to the last", () => {
    expect(nextFocusIndex(0, 3, true)).toBe(2)
  })

  test("returns -1 when length is zero", () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1)
    expect(nextFocusIndex(0, 0, true)).toBe(-1)
  })

  test("handles a single-item list with no movement", () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0)
    expect(nextFocusIndex(0, 1, true)).toBe(0)
  })
})
