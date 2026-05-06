/** @jsxImportSource @opentui/react */
import { AddRow } from "@/tui/components/add-row";
import { HasciiButton } from "@/tui/components/ui/hascii/button";
import { Card } from "@/tui/components/card";
import { EditableField } from "@/tui/components/editable-field";
import { EmptyState } from "@/tui/components/empty-state";
import { PanelHeader } from "@/tui/components/panel-header";
import { ReadonlyField } from "@/tui/components/readonly-field";
import { ViewShell } from "@/tui/components/view-shell";
import { funnel } from "@/tui/theme";
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

type Connector = Snapshot["connectors"][number];

const fieldKey = (name: string, field: string): string => `connectors::${name}::${field}`;

const formatTimestamp = (iso: string | undefined): string => {
  if (!iso) return "—";

  // ISO is always UTC; render in the user's local zone so the values
  // align with what they see in their terminal / system clock.
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return "—";

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${mn}`;
};

/**
 * Connector inspector — one Card per registered connector. Each Card
 * wraps the connector's fields (every value rendered as a split-half
 * row, label half on `surface` and value half on `elevated`).
 *
 * Below the list, four `AddRow`s create a new slack / gh / discord /
 * schedule connector with placeholder values; the user then edits the
 * fields normally.
 */
export function ConnectorsView(props: Props) {
  const connectors = props.snapshot.connectors;

  const logError = (error: unknown): void => {
    props.funnel.logger.error(error instanceof Error ? error.message : String(error));
  };

  const commit = (connector: Connector, field: string, raw: string): void => {
    try {
      if (field === "name") {
        const next = raw.trim();

        if (next && next !== connector.name) {
          props.funnel.listeners.stop(connector.name).catch(logError);
          props.funnel.connectors.rename(connector.name, next);
          props.funnel.listeners.start(next).catch(logError);
        }
      } else if (connector.type === "slack" && field === "bot-token") {
        props.funnel.connectors.updateSlack(connector.name, { botToken: raw });
        props.funnel.listeners.restart(connector.name).catch(logError);
      } else if (connector.type === "slack" && field === "app-token") {
        props.funnel.connectors.updateSlack(connector.name, { appToken: raw });
        props.funnel.listeners.restart(connector.name).catch(logError);
      } else if (connector.type === "gh" && field === "poll") {
        const seconds = Number.parseInt(raw, 10);

        if (Number.isFinite(seconds) && seconds > 0) {
          props.funnel.connectors.updateGh(connector.name, { pollInterval: seconds });
          props.funnel.listeners.restart(connector.name).catch(logError);
        }
      } else if (connector.type === "discord" && field === "bot-token") {
        props.funnel.connectors.updateDiscord(connector.name, { botToken: raw });
        props.funnel.listeners.restart(connector.name).catch(logError);
      }
    } catch (error) {
      logError(error);
    }

    props.setFocusedKey(null);
    props.refresh();
  };

  const removeConnector = (name: string): void => {
    props.funnel.listeners.stop(name).catch(logError);

    try {
      props.funnel.connectors.remove(name);
    } catch (error) {
      logError(error);
    }

    props.setFocusedKey(null);
    props.refresh();
  };

  const addConnector = (type: Connector["type"]): void => {
    const existingNames = connectors.map((c) => c.name);
    const name = uniqueName(existingNames, type);

    try {
      if (type === "slack") {
        props.funnel.connectors.add({
          type: "slack",
          name,
          botToken: "xoxb-PLACEHOLDER",
          appToken: "xapp-PLACEHOLDER",
        });
      } else if (type === "gh") {
        props.funnel.connectors.add({ type: "gh", name, pollInterval: 60 });
      } else if (type === "discord") {
        props.funnel.connectors.add({ type: "discord", name, botToken: "PLACEHOLDER" });
      } else {
        props.funnel.connectors.add({ type: "schedule", name, entries: [] });
      }
      props.setFocusedKey(fieldKey(name, "name"));
      props.funnel.listeners.start(name).catch(logError);
    } catch (error) {
      logError(error);
    }

    props.refresh();
  };

  return (
    <ViewShell>
      <PanelHeader label="connectors" count={connectors.length} />

      {connectors.length === 0 ? (
        <EmptyState message="(none — use the buttons below to add one)" />
      ) : (
        connectors.map((connector) => (
          <Card key={connector.name} title={connector.name}>
            <ReadonlyField label="type" value={connector.type} />
            <EditableField
              label="name"
              initialValue={connector.name}
              focused={props.focusedKey === fieldKey(connector.name, "name")}
              onFocus={() => props.setFocusedKey(fieldKey(connector.name, "name"))}
              onCommit={(raw) => commit(connector, "name", raw)}
            />
            {connector.type === "slack" ? (
              <>
                <EditableField
                  label="bot-token"
                  initialValue={connector.botToken}
                  focused={props.focusedKey === fieldKey(connector.name, "bot-token")}
                  onFocus={() => props.setFocusedKey(fieldKey(connector.name, "bot-token"))}
                  onCommit={(raw) => commit(connector, "bot-token", raw)}
                />
                <EditableField
                  label="app-token"
                  initialValue={connector.appToken}
                  focused={props.focusedKey === fieldKey(connector.name, "app-token")}
                  onFocus={() => props.setFocusedKey(fieldKey(connector.name, "app-token"))}
                  onCommit={(raw) => commit(connector, "app-token", raw)}
                />
              </>
            ) : null}
            {connector.type === "gh" ? (
              <EditableField
                label="poll"
                initialValue={String(connector.pollInterval ?? 60)}
                focused={props.focusedKey === fieldKey(connector.name, "poll")}
                onFocus={() => props.setFocusedKey(fieldKey(connector.name, "poll"))}
                onCommit={(raw) => commit(connector, "poll", raw)}
              />
            ) : null}
            {connector.type === "discord" ? (
              <EditableField
                label="bot-token"
                initialValue={connector.botToken}
                focused={props.focusedKey === fieldKey(connector.name, "bot-token")}
                onFocus={() => props.setFocusedKey(fieldKey(connector.name, "bot-token"))}
                onCommit={(raw) => commit(connector, "bot-token", raw)}
              />
            ) : null}
            {connector.type === "schedule" ? (
              <ReadonlyField label="entries" value={String(connector.entries.length)} />
            ) : null}
            <text fg={funnel.faint}>{`created  ${formatTimestamp(connector.createdAt)}`}</text>
            <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <text fg={funnel.faint}>{`updated  ${formatTimestamp(connector.updatedAt)}`}</text>
              <HasciiButton
                variant="destructive"
                size="sm"
                onPress={() => removeConnector(connector.name)}
              >
                delete
              </HasciiButton>
            </box>
          </Card>
        ))
      )}

      <AddRow label="add slack" onClick={() => addConnector("slack")} />
      <AddRow label="add gh" onClick={() => addConnector("gh")} />
      <AddRow label="add discord" onClick={() => addConnector("discord")} />
      <AddRow label="add schedule" onClick={() => addConnector("schedule")} />
    </ViewShell>
  );
}
