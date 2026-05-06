/** @jsxImportSource @opentui/react */
import { HasciiFormItem } from "@/tui/components/ui/hascii/form-item";
import { HasciiInput } from "@/tui/components/ui/hascii/input";

type Props = {
  label: string;
  initialValue: string;
  focused: boolean;
  onFocus: () => void;
  onCommit: (value: string) => void;
  placeholder?: string;
};

/**
 * Inline label + input row built on hascii primitives.
 *
 * Re-keying the input by `focused` forces it to re-mount on blur, so
 * Esc / click-away discards uncommitted typing and the displayed value
 * snaps back to `initialValue`. Click anywhere on the row to focus.
 */
export function EditableField(props: Props) {
  return (
    <box style={{ flexDirection: "row" }} onMouseDown={props.onFocus}>
      <HasciiFormItem label={props.label} direction="row" labelWidth={12}>
        <HasciiInput
          key={props.focused ? "focused" : "blurred"}
          value={props.initialValue}
          placeholder={props.placeholder}
          focused={props.focused}
          onSubmit={props.onCommit}
        />
      </HasciiFormItem>
    </box>
  );
}
