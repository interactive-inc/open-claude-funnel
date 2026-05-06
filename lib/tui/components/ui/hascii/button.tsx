/** @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "md" | "lg";

export type Props = {
  variant?: Variant;
  size?: Size;
  isFocused?: boolean;
  isDisabled?: boolean;
  onPress?: () => void;
  children?: ReactNode;
};

const sizeDims: Record<Size, { paddingX: number; height: number }> = {
  default: { paddingX: 2, height: 1 },
  sm: { paddingX: 1, height: 1 },
  md: { paddingX: 2, height: 1 },
  lg: { paddingX: 3, height: 3 },
};

const pickBg = (
  rest: string | undefined,
  hover: string,
  active: string,
  isHover: boolean,
  isActive: boolean,
): string | undefined => {
  if (isActive) return active;
  if (isHover) return hover;
  return rest;
};

/** A focusable terminal button. Background cycles through rest, hover, and active states. */
export function HasciiButton(props: Props) {
  const variant = props.variant ?? "default";
  const size = props.size ?? "default";
  const isFocused = props.isFocused ?? false;
  const isDisabled = props.isDisabled ?? false;

  const theme = useHasciiTheme();
  const dims = sizeDims[size];

  const hoveredState = useState(false);
  const hovered = hoveredState[0];
  const setHovered = hoveredState[1];

  const pressedState = useState(false);
  const pressed = pressedState[0];
  const setPressed = pressedState[1];

  const isHover = !isDisabled && hovered && !pressed;
  const isActive = !isDisabled && pressed;

  const flashKeyboardPress = () => {
    setPressed(true);
    setTimeout(() => setPressed(false), 120);
  };

  useKeyboard((key) => {
    if (!isFocused || isDisabled) return;

    if (key.name === "return" || key.name === "space") {
      flashKeyboardPress();
      props.onPress?.();
    }
  });

  const onMouseOver = () => {
    if (!isDisabled) setHovered(true);
  };

  const onMouseOut = () => {
    setHovered(false);
    setPressed(false);
  };

  const onMouseDown = () => {
    if (!isDisabled) setPressed(true);
  };

  const onMouseUp = () => {
    if (isDisabled) return;

    if (pressed) props.onPress?.();
    setPressed(false);
  };

  if (variant === "outline") {
    const tone = isDisabled
      ? theme.color.border
      : isActive
        ? theme.color.primaryActive
        : isHover
          ? theme.color.primaryHover
          : theme.color.primary;

    const isMedium = size === "md" || size === "default";
    const outlinePaddingX = size === "sm" ? 0 : isMedium ? 1 : size === "lg" ? 2 : dims.paddingX;
    const outlineHeight = size === "sm" || isMedium ? 3 : dims.height;

    return (
      <box
        paddingLeft={outlinePaddingX}
        paddingRight={outlinePaddingX}
        height={outlineHeight}
        border={outlineHeight >= 3}
        borderStyle="rounded"
        borderColor={tone}
        alignItems="center"
        justifyContent="center"
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
      >
        <text fg={tone}>{props.children}</text>
      </box>
    );
  }

  if (variant === "ghost") {
    const fg = isDisabled ? theme.color.mutedForeground : theme.color.foreground;
    const bg = pickBg(undefined, theme.color.accentHover, theme.color.accent, isHover, isActive);

    return (
      <box
        paddingLeft={dims.paddingX}
        paddingRight={dims.paddingX}
        height={dims.height}
        backgroundColor={bg}
        alignItems="center"
        justifyContent="center"
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
      >
        <text fg={fg}>{props.children}</text>
      </box>
    );
  }

  if (variant === "secondary") {
    const fg = isDisabled ? theme.color.mutedForeground : theme.color.secondaryForeground;
    const bg = pickBg(
      theme.color.secondary,
      theme.color.secondaryHover,
      theme.color.secondaryActive,
      isHover,
      isActive,
    );

    return (
      <box
        paddingLeft={dims.paddingX}
        paddingRight={dims.paddingX}
        height={dims.height}
        backgroundColor={bg}
        alignItems="center"
        justifyContent="center"
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
      >
        <text fg={fg}>{props.children}</text>
      </box>
    );
  }

  if (variant === "destructive") {
    const fg = isDisabled ? theme.color.mutedForeground : theme.color.destructiveForeground;
    const bg = pickBg(
      theme.color.destructive,
      theme.color.destructiveHover,
      theme.color.destructiveActive,
      isHover,
      isActive,
    );

    return (
      <box
        paddingLeft={dims.paddingX}
        paddingRight={dims.paddingX}
        height={dims.height}
        backgroundColor={bg}
        alignItems="center"
        justifyContent="center"
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
      >
        <text fg={fg}>{props.children}</text>
      </box>
    );
  }

  const fg = isDisabled ? theme.color.mutedForeground : theme.color.primaryForeground;
  const bg = pickBg(
    theme.color.primary,
    theme.color.primaryHover,
    theme.color.primaryActive,
    isHover,
    isActive,
  );

  return (
    <box
      paddingLeft={dims.paddingX}
      paddingRight={dims.paddingX}
      height={dims.height}
      backgroundColor={bg}
      alignItems="center"
      justifyContent="center"
      onMouseOver={onMouseOver}
      onMouseOut={onMouseOut}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
    >
      <text fg={fg}>{props.children}</text>
    </box>
  );
}
