/** @jsxImportSource @opentui/react */
import type { ReactNode } from "react";
import { verticalScrollbarOptions } from "@/tui/scrollbar-options";
import { funnel } from "@/tui/theme";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

type Props = {
  children: ReactNode;
};

/**
 * Outer wrapper every view renders into.
 *
 * Renders a vertical `<scrollbox>` so content that overflows the visible
 * area scrolls instead of clipping the layout. Padding follows the
 * uniform `funnel.paddingX/Y` rule and lives on the inner content
 * container (via `contentOptions`); the outer scrollbox itself is
 * transparent so multi-block views (`events` events list + DetailBar
 * sibling) still stack cleanly.
 *
 * The vertical scrollbar's track and thumb pull from the theme so the
 * widget reads as part of the surface palette instead of OpenTUI's
 * default electric blue.
 */
export function ViewShell(props: Props) {
  const theme = useHasciiTheme();

  return (
    <scrollbox
      style={{ flexGrow: 1 }}
      contentOptions={{
        flexDirection: "column",
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
        paddingTop: funnel.paddingY,
        paddingBottom: funnel.paddingY,
        gap: funnel.gap,
      }}
      verticalScrollbarOptions={verticalScrollbarOptions(theme)}
    >
      {props.children}
    </scrollbox>
  );
}
