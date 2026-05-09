/** @jsxImportSource @opentui/react */
import { Card } from "@/tui/components/card"
import { EmptyState } from "@/tui/components/empty-state"
import { Keymap } from "@/tui/components/keymap"
import { PanelHeader } from "@/tui/components/panel-header"
import { ViewShell } from "@/tui/components/view-shell"
import { funnel } from "@/tui/theme"
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context"
import type { Snapshot, StreamEvent } from "@/tui/types"

type Props = {
  snapshot: Snapshot
  events: StreamEvent[]
  selectedIndex: number
  busy: boolean
}

const eventCountBy = (events: StreamEvent[], connectorName: string): number => {
  let count = 0

  for (const event of events) {
    if (event.meta.connector === connectorName) count += 1
  }

  return count
}

/**
 * Listener registry — one Card per listener. The Card title shows the
 * listener's name; inside, a single status line carries the alive
 * dot, the connector type, and the event count. Cursor selection is
 * shown via the Card's `selected` accent. Listeners are runtime
 * entities derived from connectors, so there is no add path here —
 * register / remove a connector instead.
 */
export function ListenersView(props: Props) {
  const theme = useHasciiTheme()
  const listeners = props.snapshot.listeners

  return (
    <ViewShell>
      <PanelHeader
        label="listeners"
        count={listeners.length}
        hint={props.busy ? "working…" : undefined}
      />

      {!props.snapshot.daemonReachable ? (
        <EmptyState message="(gateway daemon offline — press G to start it)" />
      ) : listeners.length === 0 ? (
        <EmptyState message="(no listeners — register a connector first)" />
      ) : (
        listeners.map((entry, index) => {
          const aliveColor = entry.alive ? funnel.alive : funnel.dead
          const count = eventCountBy(props.events, entry.name)

          return (
            <Card key={entry.name} title={entry.name} selected={index === props.selectedIndex}>
              <text>
                <span fg={aliveColor}>{entry.alive ? "●" : "○"}</span>
                <span fg={funnel.faint}> </span>
                <span fg={theme.color.mutedForeground}>{entry.type}</span>
                {count > 0 ? <span fg={theme.color.mutedForeground}>{`  ${count}↓`}</span> : null}
              </text>
            </Card>
          )
        })
      )}

      <Keymap
        hints={[
          { key: "j/k", label: "select" },
          { key: "s", label: "start" },
          { key: "x", label: "stop" },
          { key: "R", label: "restart" },
        ]}
      />
    </ViewShell>
  )
}
