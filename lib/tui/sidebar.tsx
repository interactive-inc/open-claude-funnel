/** @jsxImportSource @opentui/react */
import { Brand } from "@/tui/components/brand";
import { GatewayStatus } from "@/tui/components/gateway-status";
import { Menu } from "@/tui/components/menu";
import { SectionHeader } from "@/tui/components/section-header";
import { SessionList } from "@/tui/components/session-list";
import { HasciiSidebar } from "@/tui/components/ui/hascii/sidebar";
import { HasciiSidebarHeader } from "@/tui/components/ui/hascii/sidebar-header";
import { funnel } from "@/tui/theme";
import type { MenuItem, Snapshot, View } from "@/tui/types";

type Props = {
  snapshot: Snapshot;
  menuItems: MenuItem[];
  view: View;
  onSelect: (view: View) => void;
  busy: boolean;
  onToggleGateway: () => void;
};

/**
 * Left rail built on hascii's HasciiSidebar shell.
 *
 * Sections (top → bottom): brand (header slot), gateway card, sessions,
 * navigation menu. The funnel `Menu` items keep the left-edge `▏`
 * primary accent and right-aligned counts that hascii's stock sidebar
 * menu does not provide.
 */
export function Sidebar(props: Props) {
  return (
    <HasciiSidebar width={funnel.sidebarWidth}>
      <HasciiSidebarHeader>
        <Brand />
      </HasciiSidebarHeader>

      <GatewayStatus
        gateway={props.snapshot.gateway}
        busy={props.busy}
        onToggle={props.onToggleGateway}
      />

      <box style={{ flexDirection: "column" }}>
        <SectionHeader label="sessions" />
        <SessionList sessions={props.snapshot.sessions} />
      </box>

      <Menu items={props.menuItems} active={props.view} onSelect={props.onSelect} />
    </HasciiSidebar>
  );
}
