/** @jsxImportSource @opentui/react */
import { AddRow } from "@/tui/components/add-row"
import { Card } from "@/tui/components/card"
import { EditableField } from "@/tui/components/editable-field"
import { EmptyState } from "@/tui/components/empty-state"
import { PanelHeader } from "@/tui/components/panel-header"
import { ReadonlyField } from "@/tui/components/readonly-field"
import { ViewShell } from "@/tui/components/view-shell"
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

type Channel = Snapshot["channels"][number]

const fieldKey = (name: string, field: string): string => `channels::${name}::${field}`

/**
 * Channel inspector — one Card per channel. Connectors live nested inside the
 * channel and are managed in the connectors view; here only the channel's
 * name and id (read-only) are shown along with a count of nested connectors.
 */
export function ChannelsView(props: Props) {
  const channels = props.snapshot.channels

  const commit = (channel: Channel, field: string, raw: string): void => {
    try {
      if (field === "name") {
        const next = raw.trim()

        if (next && next !== channel.name) props.funnel.channels.rename(channel.name, next)
      }
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error))
    }

    props.setFocusedKey(null)
    props.refresh()
  }

  const removeChannel = (name: string): void => {
    try {
      props.funnel.channels.remove(name)
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error))
    }

    props.setFocusedKey(null)
    props.refresh()
  }

  const addChannel = (): void => {
    const name = uniqueName(
      channels.map((c) => c.name),
      "channel",
    )

    try {
      const created = props.funnel.channels.add({ name })
      props.setFocusedKey(fieldKey(created.name, "name"))
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error))
    }

    props.refresh()
  }

  return (
    <ViewShell>
      <PanelHeader label="channels" count={channels.length} />

      {channels.length === 0 ? (
        <EmptyState message="(none — use the button below to add one)" />
      ) : (
        channels.map((channel) => (
          <Card
            key={channel.id}
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
            <ReadonlyField label="id" value={channel.id} />
            <ReadonlyField label="delivery" value={channel.delivery} />
            <ReadonlyField
              label="connectors"
              value={
                channel.connectors.length > 0
                  ? channel.connectors.map((c) => `${c.name}:${c.type}`).join(", ")
                  : "(none)"
              }
            />
          </Card>
        ))
      )}

      <AddRow label="add channel" onClick={addChannel} />
    </ViewShell>
  )
}
