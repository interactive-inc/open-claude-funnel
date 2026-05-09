import { HasciiFormItem } from "@/tui/components/ui/hascii/form-item"
import { HasciiInput } from "@/tui/components/ui/hascii/input"

type Props = {
  label: string
  initialValue: string
  focused: boolean
  onFocus: () => void
  onCommit: (value: string) => void
  placeholder?: string
}

/**
 * Inline label + input row built on hascii primitives. The hascii Input fires
 * `onChange` on every keystroke; we forward that to `onCommit` so callers
 * persist live (re-keying by `focused` still forces a remount on blur so the
 * input snaps back when the user clicks away without typing).
 */
export function EditableField(props: Props) {
  return (
    <box style={{ flexDirection: "row" }} onMouseDown={props.onFocus}>
      <HasciiFormItem label={props.label} labelWidth={12}>
        <HasciiInput
          key={props.focused ? "focused" : "blurred"}
          value={props.initialValue}
          placeholder={props.placeholder}
          defaultFocused={props.focused}
          onChange={props.onCommit}
        />
      </HasciiFormItem>
    </box>
  )
}
