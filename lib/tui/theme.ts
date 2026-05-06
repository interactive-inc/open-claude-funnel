import { hasciiTw } from "@/tui/utils/hascii/tw-token";

/**
 * Funnel-specific TUI tokens that hascii does not cover.
 *
 * Generic colors (background / foreground / primary / muted / etc.)
 * come from hascii via `useHasciiTheme()` — components that need them
 * read the theme there. Only the funnel-only concerns live here:
 *
 *   - status accents (`alive` / `dead` / `warn`) and the selection
 *     accent (`primary` blue) — semantic colors not in hascii's palette
 *   - the in-between background tier `surface` (zinc[900]) sitting
 *     between hascii's `background` and `muted`
 *   - the deeper text tier `faint` (zinc[600]) below `mutedForeground`
 *   - layout constants (paddingX / paddingY / gap / sidebarWidth / ...)
 */
export const funnel = {
  // ─ funnel-specific colors ────────────────────────────────
  alive: "#86efac",
  dead: "#fca5a5",
  warn: "#fcd34d",
  primary: "#3b82f6",

  surface: hasciiTw.colors.zinc[900],
  faint: hasciiTw.colors.zinc[600],

  // ─ layout ────────────────────────────────────────────────
  paddingX: 2,
  paddingY: 1,
  gap: 1,

  sidebarWidth: 24,

  modalTop: 4,
  modalInset: "20%",

  barHeight: 1,

  detailPanelHeight: 14,
} as const;
