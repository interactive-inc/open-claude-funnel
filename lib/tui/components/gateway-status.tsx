/** @jsxImportSource @opentui/react */
import { HasciiButton } from "@/tui/components/ui/hascii/button"
import { funnel } from "@/tui/theme"
import type { Snapshot } from "@/tui/types"
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context"

type Props = {
  gateway: Snapshot["gateway"]
  busy: boolean
  onToggle: () => void
}

/**
 * Compact running/stopped indicator with pid and port for the sidebar.
 *
 * The "gateway" label lives inside the same elevated block as the status
 * so the heading reads as part of the card, not a floating sidebar
 * separator on the surrounding surface tier.
 *
 * The toggle is rendered as a neutral-white `Button` with the same
 * paddingX=2 / paddingY=1 as the rest of the form chrome — no leading
 * glyph, just the verb. `busy` disables the button while a toggle is
 * in flight so rapid clicks don't stack daemon spawns.
 */
export function GatewayStatus(props: Props) {
  const theme = useHasciiTheme()

  return (
    <box
      style={{
        flexDirection: "column",
        backgroundColor: theme.color.muted,
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
        paddingTop: funnel.paddingY,
        paddingBottom: funnel.paddingY,
        gap: funnel.gap,
      }}
    >
      <text fg={funnel.faint}>gateway</text>

      {props.gateway.running ? (
        <>
          <text>
            <span fg={funnel.alive}>●</span>
            <span fg={theme.color.foreground}>{` running`}</span>
          </text>
          <text fg={funnel.faint}>{`pid ${props.gateway.pid}  ·  :${props.gateway.port}`}</text>
          <HasciiButton onPress={props.onToggle} isDisabled={props.busy}>
            {props.busy ? "stopping…" : "stop"}
          </HasciiButton>
        </>
      ) : (
        <>
          <text>
            <span fg={theme.color.mutedForeground}>○</span>
            <span fg={theme.color.mutedForeground}>{` stopped`}</span>
          </text>
          <HasciiButton onPress={props.onToggle} isDisabled={props.busy}>
            {props.busy ? "starting…" : "start"}
          </HasciiButton>
        </>
      )}
    </box>
  )
}
