/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import { funnel } from "@/tui/theme";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

/**
 * Brand mark rendered at the top of the sidebar. Carries its own paddingX
 * so it aligns with menu items (which need paddingX-less parents so their
 * active highlight spans edge-to-edge).
 */
export function Brand() {
  const theme = useHasciiTheme();

  return (
    <box
      style={{
        flexDirection: "row",
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
      }}
    >
      <text fg={theme.color.foreground} attributes={TextAttributes.BOLD}>
        funnel
      </text>
    </box>
  );
}
