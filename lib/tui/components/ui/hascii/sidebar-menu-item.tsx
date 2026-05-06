/** @jsxImportSource @opentui/react */
import { useState } from "react";
import type { ReactNode } from "react";
import type { HasciiTheme } from "@/tui/utils/hascii/theme";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

export type Props = {
  isActive?: boolean;
  isDisabled?: boolean;
  onPress?: () => void;
  children?: ReactNode;
};

const pickBg = (
  isDisabled: boolean,
  isActive: boolean,
  hovered: boolean,
  pressed: boolean,
  theme: HasciiTheme,
): string | undefined => {
  if (isDisabled) return undefined;
  if (pressed) return theme.color.secondaryActive;
  if (hovered) {
    return isActive ? theme.color.secondaryActive : theme.color.secondaryHover;
  }
  if (isActive) return theme.color.secondaryHover;
  return undefined;
};

/** Single pressable row inside HasciiSidebarContent. Background mirrors the button rest/hover/active progression. */
export function HasciiSidebarMenuItem(props: Props) {
  const isActive = props.isActive ?? false;
  const isDisabled = props.isDisabled ?? false;
  const theme = useHasciiTheme();

  const hoveredState = useState(false);
  const hovered = hoveredState[0];
  const setHovered = hoveredState[1];

  const pressedState = useState(false);
  const pressed = pressedState[0];
  const setPressed = pressedState[1];

  const bg = pickBg(isDisabled, isActive, hovered, pressed, theme);

  const fg = isDisabled
    ? theme.color.mutedForeground
    : isActive || hovered
      ? theme.color.foreground
      : theme.color.mutedForeground;

  return (
    <box
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={bg}
      onMouseOver={() => {
        if (!isDisabled) setHovered(true);
      }}
      onMouseOut={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => {
        if (!isDisabled) setPressed(true);
      }}
      onMouseUp={() => {
        if (isDisabled) return;

        if (pressed) props.onPress?.();
        setPressed(false);
      }}
    >
      <text fg={fg}>{props.children}</text>
    </box>
  );
}
