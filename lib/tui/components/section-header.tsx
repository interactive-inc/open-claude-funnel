/** @jsxImportSource @opentui/react */
import { funnel } from "@/tui/theme"

type Props = {
  label: string
}

/**
 * Tiny faint label rendered above each sidebar section. Wrapped in a box
 * because OpenTUI ignores padding on `<text>`; only boxes lay out with
 * padding.
 */
export function SectionHeader(props: Props) {
  return (
    <box
      style={{
        flexDirection: "row",
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
      }}
    >
      <text fg={funnel.faint}>{props.label}</text>
    </box>
  )
}
