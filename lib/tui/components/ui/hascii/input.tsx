/** @jsxImportSource @opentui/react */
import { useState } from "react";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

type Variant = "default" | "outline";

export type Props = {
  variant?: Variant;
  placeholder?: string;
  value?: string;
  width?: number;
  focused?: boolean;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
};

/** Single-line text input. Background (default) or border (outline) cycles rest → hover → pressed → focused. */
export function HasciiInput(props: Props) {
  const variant = props.variant ?? "default";
  const width = props.width ?? 32;
  const focused = props.focused ?? false;
  const placeholder = props.placeholder ?? "";

  const theme = useHasciiTheme();

  const hoveredState = useState(false);
  const hovered = hoveredState[0];
  const setHovered = hoveredState[1];

  const pressedState = useState(false);
  const pressed = pressedState[0];
  const setPressed = pressedState[1];

  if (variant === "outline") {
    const borderColor = pressed
      ? theme.color.foreground
      : focused
        ? theme.color.ring
        : hovered
          ? theme.color.mutedForeground
          : theme.color.input;

    return (
      <box
        border
        borderStyle="rounded"
        borderColor={borderColor}
        height={3}
        width={width}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.color.background}
        justifyContent="center"
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => {
          setHovered(false);
          setPressed(false);
        }}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
      >
        <input
          focused={focused}
          placeholder={placeholder}
          value={props.value}
          textColor={theme.color.foreground}
          placeholderColor={theme.color.mutedForeground}
          cursorColor={theme.color.foreground}
          onInput={props.onInput}
          onChange={props.onChange}
          onSubmit={(value: unknown) => {
            if (typeof value === "string") props.onSubmit?.(value);
          }}
        />
      </box>
    );
  }

  const bg = pressed
    ? theme.color.mutedForeground
    : focused
      ? theme.color.secondaryActive
      : hovered
        ? theme.color.secondaryHover
        : theme.color.muted;

  return (
    <box
      height={3}
      width={width}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={bg}
      justifyContent="center"
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
    >
      <input
        focused={focused}
        placeholder={placeholder}
        value={props.value}
        textColor={theme.color.foreground}
        placeholderColor={theme.color.mutedForeground}
        cursorColor={theme.color.foreground}
        onInput={props.onInput}
        onChange={props.onChange}
        onSubmit={(value: unknown) => {
          if (typeof value === "string") props.onSubmit?.(value);
        }}
      />
    </box>
  );
}
