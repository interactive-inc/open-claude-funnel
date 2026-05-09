/** @jsxImportSource @opentui/react */
import { HasciiFormItem } from "@/tui/components/ui/hascii/form-item"
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context"

type Props = {
  label: string
  value: string
}

/** Static label + value row that mirrors the EditableField layout. */
export function ReadonlyField(props: Props) {
  const theme = useHasciiTheme()

  return (
    <HasciiFormItem label={props.label} direction="row" labelWidth={12}>
      <text fg={theme.color.foreground}>{props.value}</text>
    </HasciiFormItem>
  )
}
