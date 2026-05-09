import { describe, expect, test } from "bun:test"
import { SPINNER_KINDS } from "@/tui/components/ui/hascii/spinner"

describe("SPINNER_KINDS", () => {
  test("exposes a non-empty frame array for every variant", () => {
    const names = Object.keys(SPINNER_KINDS)
    expect(names.length).toBeGreaterThan(0)

    for (const name of names) {
      const frames = SPINNER_KINDS[name as keyof typeof SPINNER_KINDS]
      expect(frames.length).toBeGreaterThan(0)
    }
  })

  test("braille has the expected ten frames", () => {
    expect(SPINNER_KINDS.braille.length).toBe(10)
  })
})
