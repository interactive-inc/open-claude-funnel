/** @jsxImportSource @opentui/react */
import { SessionItem } from "@/tui/components/session-item";
import { funnel } from "@/tui/theme";
import type { Session } from "@/tui/types";

type Props = {
  sessions: Session[];
};

/** Vertical list of connected sessions (Claude MCP clients) for the sidebar. */
export function SessionList(props: Props) {
  if (props.sessions.length === 0) {
    return (
      <box
        style={{
          flexDirection: "row",
          paddingLeft: funnel.paddingX,
          paddingRight: funnel.paddingX,
        }}
      >
        <text fg={funnel.faint}>(none)</text>
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column" }}>
      {props.sessions.map((session, index) => (
        <SessionItem key={`${session.channel}-${index}`} session={session} />
      ))}
    </box>
  );
}
