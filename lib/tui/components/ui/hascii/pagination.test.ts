import { describe, expect, test } from "bun:test"
import { buildPageList } from "@/tui/components/ui/hascii/pagination"

describe("buildPageList", () => {
  test("returns every page when count is at or below seven", () => {
    expect(buildPageList(1, 1)).toEqual([1])
    expect(buildPageList(3, 5)).toEqual([1, 2, 3, 4, 5])
    expect(buildPageList(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  test("collapses the right side when current is near the start", () => {
    expect(buildPageList(1, 10)).toEqual([1, 2, null, 10])
    expect(buildPageList(2, 10)).toEqual([1, 2, 3, null, 10])
    expect(buildPageList(3, 10)).toEqual([1, 2, 3, 4, null, 10])
  })

  test("collapses the left side when current is near the end", () => {
    expect(buildPageList(10, 10)).toEqual([1, null, 9, 10])
    expect(buildPageList(9, 10)).toEqual([1, null, 8, 9, 10])
    expect(buildPageList(8, 10)).toEqual([1, null, 7, 8, 9, 10])
  })

  test("collapses both sides when current is in the middle", () => {
    expect(buildPageList(5, 10)).toEqual([1, null, 4, 5, 6, null, 10])
    expect(buildPageList(6, 10)).toEqual([1, null, 5, 6, 7, null, 10])
  })

  test("omits the ellipsis when the gap would be a single page", () => {
    expect(buildPageList(2, 8)).toEqual([1, 2, 3, null, 8])
    expect(buildPageList(7, 8)).toEqual([1, null, 6, 7, 8])
  })
})
