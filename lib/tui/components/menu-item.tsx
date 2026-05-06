/** @jsxImportSource @opentui/react */
import { useState } from "react";
import { funnel } from "@/tui/theme";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

type Props = {
  label: string;
  active: boolean;
  count?: number;
  onSelect: () => void;
};

const ROW_HEIGHT = funnel.paddingY * 2 + 1;

/**
 * One row in the sidebar nav.
 *
 * Active state: a thin `▏` (U+258F LEFT ONE EIGHTH BLOCK) rule painted
 * in the primary color, stacked to fill the row height. The rule is
 * narrower than a full character cell so it reads as a delicate accent
 * instead of a heavy block. Hover and active share the same elevated
 * background; the rule is what disambiguates the two.
 */
export function MenuItem(props: Props) {
  const [hovered, setHovered] = useState(false);
  const theme = useHasciiTheme();

  const showRaised = props.active || hovered;
  const bg = showRaised ? theme.color.muted : undefined;
  const fg = showRaised ? theme.color.foreground : theme.color.foreground;
  const countFg = showRaised ? theme.color.foreground : funnel.faint;

  return (
    <box
      onMouseDown={props.onSelect}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        backgroundColor: bg,
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
        paddingTop: funnel.paddingY,
        paddingBottom: funnel.paddingY,
      }}
    >
      {props.active ? (
        <box
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            flexDirection: "column",
          }}
        >
          {Array.from({ length: ROW_HEIGHT }, (_, index) => (
            <text key={index} fg={funnel.primary}>
              ▏
            </text>
          ))}
        </box>
      ) : null}
      <text fg={fg}>{props.label}</text>
      {props.count !== undefined ? <text fg={countFg}>{String(props.count)}</text> : null}
    </box>
  );
}
