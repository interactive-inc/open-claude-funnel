/** @jsxImportSource @opentui/react */
import { funnel } from "@/tui/theme"
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context"

type Props = {
  label: string
  count?: number
  hint?: string
}

/** Dim section label rendered at the top of every Panel. */
export function PanelHeader(props: Props) {
  const theme = useHasciiTheme()
  const text = props.count !== undefined ? `${props.label} (${props.count})` : props.label

  return (
    <text fg={theme.color.mutedForeground}>
      {text}
      {props.hint ? <span fg={funnel.faint}>{`  · ${props.hint}`}</span> : null}
    </text>
  )
}
