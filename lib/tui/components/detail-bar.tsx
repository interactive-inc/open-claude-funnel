/** @jsxImportSource @opentui/react */
import type { ReactNode } from "react"
import { verticalScrollbarOptions } from "@/tui/scrollbar-options"
import { funnel } from "@/tui/theme"
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context"

type Props = {
  children: ReactNode
}

/**
 * Bottom inspector strip rendered at the foot of a view.
 *
 * Sits as a sibling of `ViewShell` (not inside it) so its background
 * stretches edge-to-edge across the main column and butts against the
 * sidebar with no horizontal gap. Background tier is `elevated` —
 * one step brighter than the sidebar — to read as a separate stratum
 * without needing a border.
 *
 * The strip is itself a `<scrollbox>` so long content (e.g., JSON for
 * the selected event) scrolls within the fixed `funnel.detailPanelHeight`
 * frame instead of pushing other UI off-screen.
 */
export function DetailBar(props: Props) {
  const theme = useHasciiTheme()

  return (
    <scrollbox
      style={{
        height: funnel.detailPanelHeight,
        backgroundColor: theme.color.muted,
      }}
      contentOptions={{
        flexDirection: "column",
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
        paddingTop: funnel.paddingY,
        paddingBottom: funnel.paddingY,
        gap: funnel.gap,
      }}
      verticalScrollbarOptions={verticalScrollbarOptions(theme)}
    >
      {props.children}
    </scrollbox>
  )
}
