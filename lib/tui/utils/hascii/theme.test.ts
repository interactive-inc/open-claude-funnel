import { describe, expect, test } from "bun:test"
import { hasciiTheme } from "@/tui/utils/hascii/theme"
import { hasciiTw } from "@/tui/utils/hascii/tw-token"

describe("hasciiTheme", () => {
  test("primary references the lightest zinc shade", () => {
    expect(hasciiTheme.color.primary).toBe(hasciiTw.colors.zinc[50])
  })

  test("destructive progresses from rest to active in red", () => {
    expect(hasciiTheme.color.destructive).toBe(hasciiTw.colors.red[900])
    expect(hasciiTheme.color.destructiveHover).toBe(hasciiTw.colors.red[800])
    expect(hasciiTheme.color.destructiveActive).toBe(hasciiTw.colors.red[700])
  })

  test("background and foreground sit at opposite ends of zinc", () => {
    expect(hasciiTheme.color.background).toBe(hasciiTw.colors.zinc[950])
    expect(hasciiTheme.color.foreground).toBe(hasciiTw.colors.zinc[50])
  })
})
