/** @jsxImportSource @opentui/react */
import { DetailBar } from "@/tui/components/detail-bar";
import { HasciiSeparator } from "@/tui/components/ui/hascii/separator";
import { EmptyState } from "@/tui/components/empty-state";
import { Keymap } from "@/tui/components/keymap";
import { PanelHeader } from "@/tui/components/panel-header";
import { ViewShell } from "@/tui/components/view-shell";
import { funnel } from "@/tui/theme";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";
import type { StreamEvent, StreamStatus } from "@/tui/types";

type Props = {
  events: StreamEvent[];
  filter: string;
  selectedIndex: number;
  streamStatus: StreamStatus;
};

const streamLabel = (status: StreamStatus): string => {
  if (status === "open") return "live";
  if (status === "connecting") return "connecting…";
  if (status === "closed") return "reconnecting…";

  return "offline";
};

const formatTime = (ms: number): string => {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
};

const truncate = (value: string, max: number): string => {
  const flat = value.replace(/\s+/g, " ").trim();

  if (flat.length <= max) return flat;

  return `${flat.slice(0, max - 1)}…`;
};

const matches = (event: StreamEvent, filter: string): boolean => {
  if (!filter) return true;

  const needle = filter.toLowerCase();
  const haystack = [
    event.content,
    event.meta.connector ?? "",
    event.meta.event_type ?? "",
    event.meta.channel ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
};

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/**
 * Live event stream + detail of the selected event.
 *
 * The events list lives inside `ViewShell` (padded canvas) while the
 * detail strip is a sibling `DetailBar` so its background spans the
 * full main column edge-to-edge and reads as a distinct elevated
 * stratum below the list.
 */
export function EventsView(props: Props) {
  const theme = useHasciiTheme();
  const visible = props.events.filter((event) => matches(event, props.filter));
  const selected = visible[props.selectedIndex] ?? null;

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <ViewShell>
        <PanelHeader
          label="events"
          count={visible.length}
          hint={[
            streamLabel(props.streamStatus),
            `${props.events.length} total`,
            props.filter ? `/${props.filter}/` : null,
          ]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        />

        {visible.length === 0 ? (
          <EmptyState message="(no events yet — waiting for the first one)" />
        ) : (
          visible.map((event, index) => {
            const isSelected = index === props.selectedIndex;
            const connector = event.meta.connector ?? "system";
            const eventType = event.meta.event_type ?? "?";

            return (
              <text key={event.id} bg={isSelected ? theme.color.muted : undefined}>
                <span fg={theme.color.mutedForeground}>{formatTime(event.receivedAt)}</span>
                <span fg={funnel.faint}> </span>
                <span fg={theme.color.mutedForeground}>{eventType.padEnd(8)}</span>
                <span fg={funnel.faint}>{" · "}</span>
                <span fg={isSelected ? theme.color.foreground : theme.color.foreground}>{connector.padEnd(14)}</span>
                <span fg={funnel.faint}> </span>
                <span fg={isSelected ? theme.color.foreground : theme.color.mutedForeground}>
                  {truncate(event.content, 80)}
                </span>
              </text>
            );
          })
        )}

        <Keymap
          hints={[
            { key: "j/k", label: "select" },
            { key: "/", label: "filter" },
          ]}
        />
      </ViewShell>

      <DetailBar>
        <PanelHeader label="detail" />

        {!selected ? (
          <EmptyState message="(select an event with j/k to inspect)" />
        ) : (
          <>
            <text>
              <span fg={theme.color.mutedForeground}>meta: </span>
              <span fg={theme.color.foreground}>
                {Object.entries(selected.meta)
                  .map(([key, value]) => `${key}=${value}`)
                  .join("  ")}
              </span>
            </text>
            <HasciiSeparator />
            <text fg={theme.color.foreground}>{formatJson(tryParseJson(selected.content))}</text>
          </>
        )}
      </DetailBar>
    </box>
  );
}
