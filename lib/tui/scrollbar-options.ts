import { funnel } from "@/tui/theme";
import type { HasciiTheme } from "@/tui/utils/hascii/theme";

/**
 * Shared OpenTUI scrollbar styling. Used by `ViewShell` and `DetailBar`
 * so both scroll containers paint the track with the surrounding
 * `surface` tone and the thumb in `mutedForeground` instead of OpenTUI's
 * default electric blue.
 *
 * Takes the active hascii theme since scrollbar coloring depends on
 * the same palette as everything else.
 */
export const verticalScrollbarOptions = (theme: HasciiTheme) =>
  ({
    trackOptions: {
      backgroundColor: funnel.surface,
      foregroundColor: theme.color.mutedForeground,
    },
  }) as const;
