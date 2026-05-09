/** @jsxImportSource @opentui/react */
import { funnel } from "@/tui/theme"

const RULE_LENGTH = 20

/**
 * A thin `▏` (U+258F) primary-colour rule pinned to the left edge of
 * the parent box. Stacked tall enough to span any reasonable card or
 * field-group height; rows past the parent's bottom edge are clipped.
 *
 * Use inside a `position: relative` parent to mark it as the "current"
 * selection — same look as the sidebar `MenuItem` active accent.
 */
export function SelectionAccent() {
  return (
    <box
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        flexDirection: "column",
      }}
    >
      {Array.from({ length: RULE_LENGTH }, (_, index) => (
        <text key={index} fg={funnel.primary}>
          ▏
        </text>
      ))}
    </box>
  )
}
