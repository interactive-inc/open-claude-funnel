/** @jsxImportSource @opentui/react */
import { useState } from "react";
import type { ReactNode } from "react";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

export type Props = {
  onClose?: () => void;
  children?: ReactNode;
};

/** Dialog header row. Children rendered on the left; an x close button is rendered top-right when onClose is provided. */
export function HasciiDialogHeader(props: Props) {
  const theme = useHasciiTheme();

  const hoveredState = useState(false);
  const hovered = hoveredState[0];
  const setHovered = hoveredState[1];

  const pressedState = useState(false);
  const pressed = pressedState[0];
  const setPressed = pressedState[1];

  const closeFg = pressed
    ? theme.color.primaryActive
    : hovered
      ? theme.color.foreground
      : theme.color.mutedForeground;

  return (
    <box flexDirection="row" alignItems="flex-start" justifyContent="space-between">
      <box flexDirection="column" flexGrow={1} gap={1}>
        {props.children}
      </box>
      {props.onClose ? (
        <box
          paddingLeft={1}
          paddingRight={1}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => {
            setHovered(false);
            setPressed(false);
          }}
          onMouseDown={() => setPressed(true)}
          onMouseUp={() => {
            if (pressed) props.onClose?.();
            setPressed(false);
          }}
        >
          <text fg={closeFg}>x</text>
        </box>
      ) : null}
    </box>
  );
}
