/** @jsxImportSource @opentui/react */
import type { ReactNode } from "react";
import { useHasciiToggleGroup } from "@/tui/components/ui/hascii/toggle-group";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

export type Props = {
  value: string;
  children?: ReactNode;
};

/** Pressable cell inside HasciiToggleGroup. Pressed state is controlled by the surrounding group. */
export function HasciiToggleGroupItem(props: Props) {
  const theme = useHasciiTheme();
  const ctx = useHasciiToggleGroup();

  const isPressed = ctx?.isPressed(props.value) ?? false;

  const bg = isPressed ? theme.color.primary : theme.color.muted;
  const fg = isPressed ? theme.color.primaryForeground : theme.color.mutedForeground;

  return (
    <box
      height={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={bg}
      onMouseUp={() => ctx?.toggle(props.value)}
    >
      <text fg={fg}>{props.children}</text>
    </box>
  );
}
