/** @jsxImportSource @opentui/react */
import { funnel } from "@/tui/theme"
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context"

type Props = {
  value: string
  active: boolean
}

/** Inline filter overlay shown when the user presses `/`. */
export function FilterInput(props: Props) {
  const theme = useHasciiTheme()

  if (!props.active) return null

  return (
    <box
      style={{
        height: funnel.barHeight,
        backgroundColor: theme.color.muted,
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
      }}
    >
      <text>
        <span fg={theme.color.foreground}>/</span>
        <span fg={theme.color.foreground}>{props.value}</span>
        <span fg={theme.color.foreground}>█</span>
        <span fg={theme.color.mutedForeground}>{"  · Enter to apply · Esc to cancel"}</span>
      </text>
    </box>
  )
}
