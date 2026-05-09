/** @jsxImportSource @opentui/react */
import type { ReactNode } from "react"
import { HasciiButton } from "@/tui/components/ui/hascii/button"
import { HasciiCard } from "@/tui/components/ui/hascii/card"
import { HasciiCardFooter } from "@/tui/components/ui/hascii/card-footer"
import { HasciiCardHeader } from "@/tui/components/ui/hascii/card-header"
import { HasciiCardTitle } from "@/tui/components/ui/hascii/card-title"
import { SelectionAccent } from "@/tui/components/selection-accent"

type Props = {
  /** Entity identifier shown at the top so each Card reads as one item. */
  title: string
  children: ReactNode
  /** When provided, a destructive "delete" Button is rendered bottom-right. */
  onDelete?: () => void
  selected?: boolean
}

/**
 * Per-entity form wrapper used inside the connectors / channels /
 * profiles / listeners views.
 *
 * Composed from hascii's `HasciiCard` family — header + body + footer.
 * `selected` overlays a `SelectionAccent` (▏ primary rule) at the left
 * edge for cursor-driven views.
 */
export function Card(props: Props) {
  return (
    <HasciiCard>
      {props.selected ? <SelectionAccent /> : null}
      <HasciiCardHeader>
        <HasciiCardTitle>{props.title}</HasciiCardTitle>
      </HasciiCardHeader>
      {props.children}
      {props.onDelete ? (
        <HasciiCardFooter>
          <HasciiButton variant="destructive" size="sm" onPress={props.onDelete}>
            delete
          </HasciiButton>
        </HasciiCardFooter>
      ) : null}
    </HasciiCard>
  )
}
