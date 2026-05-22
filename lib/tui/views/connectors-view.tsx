import { AddRow } from "@/tui/components/add-row"
import { Card } from "@/tui/components/card"
import { EmptyState } from "@/tui/components/empty-state"
import { PanelHeader } from "@/tui/components/panel-header"
import { ReadonlyField } from "@/tui/components/readonly-field"
import { HasciiButton } from "@/tui/components/ui/hascii/button"
import { ViewShell } from "@/tui/components/view-shell"
import { funnel } from "@/tui/theme"
import type { Snapshot } from "@/tui/types"
import { uniqueName } from "@/tui/unique-name"
import type { Funnel } from "@/funnel"

type Props = {
  snapshot: Snapshot
  funnel: Funnel
  refresh: () => void
  focusedKey: string | null
  setFocusedKey: (key: string | null) => void
}

type Connector = Snapshot["connectors"][number]
type ConnectorType = Connector["type"]

const formatTimestamp = (iso: string | undefined): string => {
  if (!iso) return "—"

  const d = new Date(iso)

  if (Number.isNaN(d.getTime())) return "—"

  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mn = String(d.getMinutes()).padStart(2, "0")

  return `${yyyy}-${mm}-${dd} ${hh}:${mn}`
}

/**
 * Channel-scoped connector inspector. Reads `funnel.channels.listAllConnectors()`
 * (already flattened with channelName / channelId tags) and lets the user delete
 * each connector or quickly add a new one to the first available channel via the
 * AddRow buttons. Editing values is intentionally read-only — token / pollInterval
 * mutation belongs to `fnl channels <ch> connectors set <conn> ...` because the
 * same connector name can exist in multiple channels and inline edits would have
 * to disambiguate.
 */
export function ConnectorsView(props: Props) {
  const connectors = props.snapshot.connectors
  const channels = props.snapshot.channels
  const targetChannel = channels[0] ?? null

  const logError = (error: unknown): void => {
    props.funnel.logger?.error(error instanceof Error ? error.message : String(error))
  }

  const removeConnector = (connector: Connector): void => {
    props.funnel.listeners.stop(connector.channelName, connector.name).catch(logError)

    try {
      props.funnel.channels.removeConnector(connector.channelName, connector.name)
    } catch (error) {
      logError(error)
    }

    props.refresh()
  }

  const addConnector = (type: ConnectorType): void => {
    if (!targetChannel) {
      logError(new Error("add a channel first before creating a connector"))

      return
    }

    const existingNames = connectors
      .filter((c) => c.channelId === targetChannel.id)
      .map((c) => c.name)
    const name = uniqueName(existingNames, type)

    try {
      if (type === "slack") {
        props.funnel.channels.addConnector(targetChannel.name, {
          type: "slack",
          name,
          botToken: "xoxb-PLACEHOLDER",
          appToken: "xapp-PLACEHOLDER",
        })
      } else if (type === "gh") {
        props.funnel.channels.addConnector(targetChannel.name, { type: "gh", name })
      } else if (type === "discord") {
        props.funnel.channels.addConnector(targetChannel.name, {
          type: "discord",
          name,
          botToken: "PLACEHOLDER-PLACEHOLDER",
        })
      } else {
        props.funnel.channels.addConnector(targetChannel.name, { type: "schedule", name })
      }

      props.funnel.listeners.start(targetChannel.name, name).catch(logError)
    } catch (error) {
      logError(error)
    }

    props.refresh()
  }

  return (
    <ViewShell>
      <PanelHeader label="connectors" count={connectors.length} />

      {connectors.length === 0 ? (
        <EmptyState message="(none — add via the buttons below or `fnl channels <ch> connectors add ...`)" />
      ) : (
        connectors.map((connector) => (
          <Card key={`${connector.channelId}::${connector.id}`} title={connector.name}>
            <ReadonlyField label="channel" value={connector.channelName} />
            <ReadonlyField label="type" value={connector.type} />
            <ReadonlyField label="id" value={connector.id} />
            {connector.type === "slack" ? (
              <>
                <ReadonlyField label="bot-token" value={connector.botToken} />
                <ReadonlyField label="app-token" value={connector.appToken} />
              </>
            ) : null}
            {connector.type === "gh" ? (
              <ReadonlyField label="poll" value={String(connector.pollInterval ?? 60)} />
            ) : null}
            {connector.type === "discord" ? (
              <ReadonlyField label="bot-token" value={connector.botToken} />
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
                onPress={() => removeConnector(connector)}
              >
                delete
              </HasciiButton>
            </box>
          </Card>
        ))
      )}

      {targetChannel ? (
        <text fg={funnel.faint}>{`add target channel: ${targetChannel.name}`}</text>
      ) : (
        <text fg={funnel.warn}>add a channel first to enable the buttons below</text>
      )}

      <AddRow label="add slack" onClick={() => addConnector("slack")} />
      <AddRow label="add gh" onClick={() => addConnector("gh")} />
      <AddRow label="add discord" onClick={() => addConnector("discord")} />
      <AddRow label="add schedule" onClick={() => addConnector("schedule")} />
    </ViewShell>
  )
}
