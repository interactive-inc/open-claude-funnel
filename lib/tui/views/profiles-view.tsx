/** @jsxImportSource @opentui/react */
import { AddRow } from "@/tui/components/add-row"
import { Card } from "@/tui/components/card"
import { EditableField } from "@/tui/components/editable-field"
import { EmptyState } from "@/tui/components/empty-state"
import { Keymap } from "@/tui/components/keymap"
import { PanelHeader } from "@/tui/components/panel-header"
import { ViewShell } from "@/tui/components/view-shell"
import type { Snapshot } from "@/tui/types"
import { uniqueName } from "@/tui/unique-name"
import type { Funnel } from "@/funnel"

type Props = {
  snapshot: Snapshot
  selectedIndex: number
  funnel: Funnel
  refresh: () => void
  focusedKey: string | null
  setFocusedKey: (key: string | null) => void
}

type Profile = Snapshot["profiles"][number]

const fieldKey = (name: string, field: string): string => `profiles::${name}::${field}`

/**
 * Profile list — one Card per profile. Selection (j/k cursor) shows the
 * `▏` primary rule via the Card's `selected` prop; pressing `c`
 * launches Claude Code with the selected profile.
 *
 * `+ add profile` at the foot creates a new profile pointed at the
 * first existing channel (or an empty string if there are none, which
 * the user must then edit before launching).
 */
export function ProfilesView(props: Props) {
  const profiles = props.snapshot.profiles
  const channels = props.snapshot.channels

  const commit = (profile: Profile, field: string, raw: string): void => {
    try {
      if (field === "name") {
        const next = raw.trim()

        if (next && next !== profile.name) props.funnel.profiles.rename(profile.name, next)
      } else if (field === "channel") {
        const next = raw.trim()

        if (next) props.funnel.profiles.update(profile.name, { channelId: next })
      } else if (field === "path") {
        const next = raw.trim()

        if (next) props.funnel.profiles.update(profile.name, { path: next })
      }
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error))
    }

    props.setFocusedKey(null)
    props.refresh()
  }

  const removeProfile = (name: string): void => {
    try {
      props.funnel.profiles.remove(name)
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error))
    }

    props.setFocusedKey(null)
    props.refresh()
  }

  const addProfile = (): void => {
    const name = uniqueName(
      profiles.map((p) => p.name),
      "profile",
    )
    const channelId = channels[0]?.name ?? ""

    try {
      props.funnel.profiles.add({ name, path: "", channelId })
      props.setFocusedKey(fieldKey(name, "name"))
    } catch (error) {
      props.funnel.logger.error(error instanceof Error ? error.message : String(error))
    }

    props.refresh()
  }

  return (
    <ViewShell>
      <PanelHeader label="profiles" count={profiles.length} />

      {profiles.length === 0 ? (
        <EmptyState message="(none — use the button below to add one)" />
      ) : (
        profiles.map((profile, index) => (
          <Card
            key={profile.name}
            title={profile.name}
            selected={index === props.selectedIndex}
            onDelete={() => removeProfile(profile.name)}
          >
            <EditableField
              label="name"
              initialValue={profile.name}
              focused={props.focusedKey === fieldKey(profile.name, "name")}
              onFocus={() => props.setFocusedKey(fieldKey(profile.name, "name"))}
              onCommit={(raw) => commit(profile, "name", raw)}
            />
            <EditableField
              label="path"
              initialValue={profile.path}
              focused={props.focusedKey === fieldKey(profile.name, "path")}
              onFocus={() => props.setFocusedKey(fieldKey(profile.name, "path"))}
              onCommit={(raw) => commit(profile, "path", raw)}
              placeholder="repository path"
            />
            <EditableField
              label="channel"
              initialValue={profile.channelId}
              focused={props.focusedKey === fieldKey(profile.name, "channel")}
              onFocus={() => props.setFocusedKey(fieldKey(profile.name, "channel"))}
              onCommit={(raw) => commit(profile, "channel", raw)}
            />
          </Card>
        ))
      )}

      <AddRow label="add profile" onClick={addProfile} />

      <Keymap
        hints={[
          { key: "j/k", label: "select" },
          { key: "c", label: "launch" },
        ]}
      />
    </ViewShell>
  )
}
