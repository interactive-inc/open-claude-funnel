/** @jsxImportSource @opentui/react */
import { funnel } from "@/tui/theme";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

type Hint = {
  key: string;
  label: string;
};

type Props = {
  hints: Hint[];
};

/** Inline keymap row — used at the bottom of each interactive view. */
export function Keymap(props: Props) {
  const theme = useHasciiTheme();

  return (
    <text fg={theme.color.mutedForeground}>
      {props.hints.map((hint, index) => (
        <span key={hint.key}>
          {index > 0 ? <span fg={funnel.faint}>{"  ·  "}</span> : null}
          <span fg={funnel.faint}>{hint.key} </span>
          {hint.label}
        </span>
      ))}
    </text>
  );
}
