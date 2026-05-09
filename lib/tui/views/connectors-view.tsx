/** @jsxImportSource @opentui/react */
import { Card } from "@/tui/components/card"
import { EmptyState } from "@/tui/components/empty-state"
import { PanelHeader } from "@/tui/components/panel-header"
import { ReadonlyField } from "@/tui/components/readonly-field"
import { ViewShell } from "@/tui/components/view-shell"
import { funnel } from "@/tui/theme"
import type { Snapshot } from "@/tui/types"
import type { Funnel } from "@/funnel"

type Props = {
  snapshot: Snapshot
  funnel: Funnel
  refresh: () => void
  focusedKey: string | null
  setFocusedKey: (key: string | null) => void
}

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
 * Read-only inspector for every channel-scoped connector. Mutations now go
 * through `fnl channels <ch> connectors ...` because the same connector name
 * can exist in different channels — making in-place TUI editing ambiguous.
 */
export function ConnectorsView(props: Props) {
  const connectors = props.snapshot.connectors

  return (
    <ViewShell>
      <PanelHeader label="connectors" count={connectors.length} />

      {connectors.length === 0 ? (
        <EmptyState message="(none — add via `fnl channels <channel> connectors add ...`)" />
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
            <text fg={funnel.faint}>{`updated  ${formatTimestamp(connector.updatedAt)}`}</text>
          </Card>
        ))
      )}
    </ViewShell>
  )
}
