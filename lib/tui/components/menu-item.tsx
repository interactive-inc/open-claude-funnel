/** @jsxImportSource @opentui/react */
import { funnel } from "@/tui/theme"
import { usePressable } from "@/tui/hooks/hascii/use-pressable"
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context"

type Props = {
  label: string
  active: boolean
  count?: number
  onSelect: () => void
}

const ROW_HEIGHT = funnel.paddingY * 2 + 1

/**
 * One row in the sidebar nav.
 *
 * Active state: a thin `▏` (U+258F LEFT ONE EIGHTH BLOCK) rule painted
 * in the primary color, stacked to fill the row height. The rule is
 * narrower than a full character cell so it reads as a delicate accent
 * instead of a heavy block. The sidebar's own background is `muted`,
 * so hover/active lift the row to `secondaryHover` / `secondaryActive`
 * to read against it.
 */
export function MenuItem(props: Props) {
  const theme = useHasciiTheme()
  const press = usePressable({ onPress: props.onSelect })

  const bg = press.isPressed
    ? theme.color.secondaryActive
    : props.active || press.isHovered
      ? theme.color.secondaryHover
      : undefined

  const isLifted = props.active || press.isHovered || press.isPressed
  const fg = isLifted ? theme.color.foreground : theme.color.foreground
  const countFg = isLifted ? theme.color.foreground : funnel.faint

  return (
    <box
      {...press.bind}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        backgroundColor: bg,
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
        paddingTop: funnel.paddingY,
        paddingBottom: funnel.paddingY,
      }}
    >
      {props.active ? (
        <box
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            flexDirection: "column",
          }}
        >
          {Array.from({ length: ROW_HEIGHT }, (_, index) => (
            <text key={index} fg={funnel.primary}>
              ▏
            </text>
          ))}
        </box>
      ) : null}
      <text fg={fg}>{props.label}</text>
      {props.count !== undefined ? <text fg={countFg}>{String(props.count)}</text> : null}
    </box>
  )
}
