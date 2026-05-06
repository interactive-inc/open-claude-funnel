/** @jsxImportSource @opentui/react */
import { AddRow } from "@/tui/components/add-row";
import { Card } from "@/tui/components/card";
import { EditableField } from "@/tui/components/editable-field";
import { EmptyState } from "@/tui/components/empty-state";
import { PanelHeader } from "@/tui/components/panel-header";
import { ViewShell } from "@/tui/components/view-shell";
import { parseCommaList } from "@/tui/parse-comma-list";
import type { Snapshot } from "@/tui/types";
import { uniqueName } from "@/tui/unique-name";
import type { Funnel } from "@/funnel";

type Props = {
  snapshot: Snapshot;
  funnel: Funnel;
  refresh: () => void;
  focusedKey: string | null;
  setFocusedKey: (key: string | null) => void;
};

type Channel = Snapshot["channels"][number];

const fieldKey = (name: string, field: string): string => `channels::${name}::${field}`;

/**
 * Channel inspector — one Card per channel wrapping the split-half
 * editable rows. `+ add channel` at the foot creates a new empty
 * channel (no connectors) which the user can then rename and attach
 * connectors to inline.
 */
export function ChannelsView(props: Props) {
  const channels = props.snapshot.channels;

  const commit = (channel: Channel, field: string, raw: string): void => {
    try {
      if (field === "name") {
        const next = raw.trim();

        if (next && next !== channel.name) props.funnel.channels.rename(channel.name, next);
      } else if (field === "connectors") {
        const next = parseCommaList(raw);
        const current = channel.connectors;

        for (const name of current) {
          if (!next.includes(name)) props.funnel.channels.detachConnector(channel.name, name);
        }
        for (const name of next) {
          if (!current.includes(name)) props.funnel.channels.attachConnector(channel.name, name);
        }
      }
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error));
    }

    props.setFocusedKey(null);
    props.refresh();
  };

  const removeChannel = (name: string): void => {
    try {
      props.funnel.channels.remove(name);
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error));
    }

    props.setFocusedKey(null);
    props.refresh();
  };

  const addChannel = (): void => {
    const name = uniqueName(
      channels.map((c) => c.name),
      "channel",
    );

    try {
      props.funnel.channels.add({ name, connectors: [] });
      props.setFocusedKey(fieldKey(name, "name"));
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error));
    }

    props.refresh();
  };

  return (
    <ViewShell>
      <PanelHeader label="channels" count={channels.length} />

      {channels.length === 0 ? (
        <EmptyState message="(none — use the button below to add one)" />
      ) : (
        channels.map((channel) => (
          <Card
            key={channel.name}
            title={channel.name}
            onDelete={() => removeChannel(channel.name)}
          >
            <EditableField
              label="name"
              initialValue={channel.name}
              focused={props.focusedKey === fieldKey(channel.name, "name")}
              onFocus={() => props.setFocusedKey(fieldKey(channel.name, "name"))}
              onCommit={(raw) => commit(channel, "name", raw)}
            />
            <EditableField
              label="connectors"
              initialValue={channel.connectors.join(", ")}
              focused={props.focusedKey === fieldKey(channel.name, "connectors")}
              onFocus={() => props.setFocusedKey(fieldKey(channel.name, "connectors"))}
              onCommit={(raw) => commit(channel, "connectors", raw)}
              placeholder="comma-separated connector names"
            />
          </Card>
        ))
      )}

      <AddRow label="add channel" onClick={addChannel} />
    </ViewShell>
  );
}
