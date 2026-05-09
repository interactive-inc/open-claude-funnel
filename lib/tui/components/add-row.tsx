/** @jsxImportSource @opentui/react */
import { HasciiButton } from "@/tui/components/ui/hascii/button"

type Props = {
  label: string
  onClick: () => void
}

/**
 * "+ add …" row used at the foot of an entity list.
 *
 * Bound to hascii's primary `HasciiButton` so AddRows match the gateway's
 * start / stop affordance — same neutral-white CTA chip with darken-
 * on-hover feel.
 */
export function AddRow(props: Props) {
  return <HasciiButton onPress={props.onClick}>{`+ ${props.label}`}</HasciiButton>
}
