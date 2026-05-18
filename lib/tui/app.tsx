/** @jsxImportSource @opentui/react */
import { useKeyboard, useRenderer } from "@opentui/react"
import { useState } from "react"
import { FilterInput } from "@/tui/filter-input"
import { ProfileLauncher } from "@/tui/profile-launcher"
import { Sidebar } from "@/tui/sidebar"
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context"
import type { MenuItem, Mode, View } from "@/tui/types"
import { useEventStream } from "@/tui/use-event-stream"
import { useSnapshot } from "@/tui/use-snapshot"
import { ChannelsView } from "@/tui/views/channels-view"
import { ConnectorsView } from "@/tui/views/connectors-view"
import { EventsView } from "@/tui/views/events-view"
import { ListenersView } from "@/tui/views/listeners-view"
import { ProfilesView } from "@/tui/views/profiles-view"
import type { Funnel } from "@/funnel"

type Props = {
  funnel: Funnel
}

const VIEW_KEYS: View[] = ["events", "connectors", "channels", "profiles", "listeners"]

const clamp = (value: number, length: number): number => {
  if (length === 0) return 0
  if (value < 0) return 0
  if (value >= length) return length - 1

  return value
}

const matchesEventFilter = (
  event: { content: string; meta: Record<string, string> },
  filter: string,
): boolean => {
  if (!filter) return true

  const needle = filter.toLowerCase()
  const haystack = [
    event.content,
    event.meta.connector ?? "",
    event.meta.event_type ?? "",
    event.meta.channel ?? "",
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(needle)
}

/**
 * Funnel TUI: side-rail navigation + main content panel.
 *
 * Default landing view is the live `events` log. The sidebar shows the
 * gateway state, currently connected sessions, and a navigation menu
 * where each row carries the live count of its underlying entity.
 */
export function App(props: Props) {
  const theme = useHasciiTheme()
  const renderer = useRenderer()
  const { snapshot, refresh } = useSnapshot(props.funnel)
  const { events, status: streamStatus } = useEventStream(
    snapshot.gateway.port,
    snapshot.daemonReachable,
    props.funnel.gatewayToken.read(),
  )

  const [view, setViewState] = useState<View>("events")
  const [mode, setMode] = useState<Mode>("browse")
  const [listenerCursor, setListenerCursor] = useState(0)
  const [profileCursor, setProfileCursor] = useState(0)
  const [eventCursor, setEventCursor] = useState(0)
  const [filter, setFilter] = useState("")
  const [filterDraft, setFilterDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [editFocus, setEditFocus] = useState<string | null>(null)

  const isEditing = editFocus !== null

  const setView = (next: View) => {
    setViewState(next)
    setEditFocus(null)
  }

  const visibleEventCount = events.filter((event) => matchesEventFilter(event, filter)).length

  const menuItems: MenuItem[] = [
    { view: "events", label: "events", count: events.length },
    { view: "connectors", label: "connectors", count: snapshot.connectors.length },
    { view: "channels", label: "channels", count: snapshot.channels.length },
    { view: "profiles", label: "profiles", count: snapshot.profiles.length },
    { view: "listeners", label: "listeners", count: snapshot.listeners.length },
  ]

  const moveCursor = (delta: number) => {
    if (view === "listeners") {
      setListenerCursor((prev) => clamp(prev + delta, snapshot.listeners.length))
    } else if (view === "profiles") {
      setProfileCursor((prev) => clamp(prev + delta, snapshot.profiles.length))
    } else if (view === "events") {
      setEventCursor((prev) => clamp(prev + delta, visibleEventCount))
    }
  }

  const runListenerAction = async (action: "start" | "stop" | "restart") => {
    const entry = snapshot.listeners[listenerCursor]

    if (!entry || busy) return

    setBusy(true)

    if (action === "start") await props.funnel.listeners.start(entry.channelName, entry.name)
    if (action === "stop") await props.funnel.listeners.stop(entry.channelName, entry.name)
    if (action === "restart") await props.funnel.listeners.restart(entry.channelName, entry.name)

    setBusy(false)
    refresh()
  }

  const launchProfile = async () => {
    const profile = snapshot.profiles[profileCursor]

    if (!profile) return

    renderer.destroy()

    try {
      await props.funnel.claude.launch({
        channel: profile.channelId,
        cwd: profile.path,
        profileName: profile.name,
      })
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    }

    process.exit(0)
  }

  const toggleGateway = async () => {
    if (busy) return

    setBusy(true)

    if (snapshot.gateway.running) {
      await props.funnel.gateway.stop()
    } else {
      await props.funnel.gateway.start()
    }

    setBusy(false)
    refresh()
  }

  useKeyboard((key) => {
    if (isEditing) {
      if (key.name === "escape") setEditFocus(null)
      return
    }

    if (mode === "filter") {
      if (key.name === "return") {
        setFilter(filterDraft)
        setEventCursor(0)
        setMode("browse")
        return
      }

      if (key.name === "escape") {
        setFilterDraft(filter)
        setMode("browse")
        return
      }

      if (key.name === "backspace") {
        setFilterDraft((prev) => prev.slice(0, -1))
        return
      }

      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        const ch = key.sequence

        if (ch >= " " && ch <= "~") {
          setFilterDraft((prev) => prev + ch)
        }
      }

      return
    }

    if (mode === "profile-launcher") {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        setMode("browse")
        return
      }

      if (key.name === "up" || key.name === "k") {
        setProfileCursor((prev) => clamp(prev - 1, snapshot.profiles.length))
        return
      }

      if (key.name === "down" || key.name === "j") {
        setProfileCursor((prev) => clamp(prev + 1, snapshot.profiles.length))
        return
      }

      if (key.name === "return") {
        void launchProfile()
      }

      return
    }

    if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
      renderer.destroy()
      return
    }

    const numericIndex = Number.parseInt(key.name ?? "", 10)
    const target = Number.isFinite(numericIndex) ? VIEW_KEYS[numericIndex - 1] : undefined

    if (target) {
      setView(target)
      return
    }

    if (key.name === "j" || key.name === "down") {
      moveCursor(1)
      return
    }

    if (key.name === "k" || key.name === "up") {
      moveCursor(-1)
      return
    }

    if (key.name === "r") {
      refresh()
      return
    }

    if (key.name === "/" && view === "events") {
      setFilterDraft(filter)
      setMode("filter")
      return
    }

    if (key.name === "c") {
      if (snapshot.profiles.length === 0) return

      setProfileCursor((prev) => Math.min(prev, Math.max(0, snapshot.profiles.length - 1)))
      setMode("profile-launcher")
      return
    }

    if (view === "listeners") {
      if (key.name === "s") {
        void runListenerAction("start")
        return
      }

      if (key.name === "x") {
        void runListenerAction("stop")
        return
      }

      if (key.name === "R" || (key.shift && key.name === "r")) {
        void runListenerAction("restart")
        return
      }
    }

    if (key.name === "G" || (key.shift && key.name === "g")) {
      void toggleGateway()
    }
  })

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: theme.color.background,
        flexDirection: "column",
      }}
    >
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <Sidebar
          snapshot={snapshot}
          menuItems={menuItems}
          view={view}
          onSelect={setView}
          busy={busy}
          onToggleGateway={() => void toggleGateway()}
        />

        <box
          style={{
            flexDirection: "column",
            flexGrow: 1,
            backgroundColor: theme.color.background,
          }}
        >
          {view === "events" ? (
            <EventsView
              events={events}
              filter={filter}
              selectedIndex={eventCursor}
              streamStatus={streamStatus}
            />
          ) : view === "connectors" ? (
            <ConnectorsView
              snapshot={snapshot}
              funnel={props.funnel}
              refresh={refresh}
              focusedKey={editFocus}
              setFocusedKey={setEditFocus}
            />
          ) : view === "channels" ? (
            <ChannelsView
              snapshot={snapshot}
              funnel={props.funnel}
              refresh={refresh}
              focusedKey={editFocus}
              setFocusedKey={setEditFocus}
            />
          ) : view === "profiles" ? (
            <ProfilesView
              snapshot={snapshot}
              selectedIndex={profileCursor}
              funnel={props.funnel}
              refresh={refresh}
              focusedKey={editFocus}
              setFocusedKey={setEditFocus}
            />
          ) : (
            <ListenersView
              snapshot={snapshot}
              events={events}
              selectedIndex={listenerCursor}
              busy={busy}
            />
          )}
        </box>
      </box>

      <FilterInput value={filterDraft} active={mode === "filter"} />
      <ProfileLauncher
        active={mode === "profile-launcher"}
        profiles={snapshot.profiles}
        selectedIndex={profileCursor}
      />
    </box>
  )
}
