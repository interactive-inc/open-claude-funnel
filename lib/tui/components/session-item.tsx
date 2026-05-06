/** @jsxImportSource @opentui/react */
import { funnel } from "@/tui/theme";
import type { Session } from "@/tui/types";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";

type Props = {
  session: Session;
};

/** One connected WebSocket session — channel name + connector summary. */
export function SessionItem(props: Props) {
  const theme = useHasciiTheme();
  const { session } = props;
  const summary =
    session.connectors.length === 0
      ? "(no connectors)"
      : session.connectors.length === 1
        ? session.connectors[0]
        : `${session.connectors.length} connectors`;

  return (
    <box
      style={{
        flexDirection: "column",
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
      }}
    >
      <text fg={theme.color.foreground}>{session.channel || "(unnamed)"}</text>
      <text fg={funnel.faint}>{summary}</text>
    </box>
  );
}
