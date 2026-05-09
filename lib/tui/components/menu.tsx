/** @jsxImportSource @opentui/react */
import { MenuItem } from "@/tui/components/menu-item"
import type { MenuItem as MenuItemType, View } from "@/tui/types"

type Props = {
  items: MenuItemType[]
  active: View
  onSelect: (view: View) => void
}

/** Vertical list of clickable nav rows. Each row is a `MenuItem`. */
export function Menu(props: Props) {
  return (
    <box style={{ flexDirection: "column" }}>
      {props.items.map((item) => (
        <MenuItem
          key={item.view}
          label={item.label}
          active={item.view === props.active}
          count={item.count}
          onSelect={() => props.onSelect(item.view)}
        />
      ))}
    </box>
  )
}
