import { describe, expect, test } from "bun:test"
import { parseCommaList } from "@/tui/parse-comma-list"

describe("parseCommaList", () => {
  test("splits by comma and trims whitespace", () => {
    expect(parseCommaList("a, b , c")).toEqual(["a", "b", "c"])
  })

  test("drops empty entries from trailing commas", () => {
    expect(parseCommaList("a,,b,")).toEqual(["a", "b"])
  })

  test("returns an empty array for an empty string", () => {
    expect(parseCommaList("")).toEqual([])
  })

  test("returns an empty array for whitespace-only input", () => {
    expect(parseCommaList("   ,  ,   ")).toEqual([])
  })

  test("preserves a single un-comma'd entry", () => {
    expect(parseCommaList("only")).toEqual(["only"])
  })
})
