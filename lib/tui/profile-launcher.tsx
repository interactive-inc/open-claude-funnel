/** @jsxImportSource @opentui/react */
import { HasciiSeparator } from "@/tui/components/ui/hascii/separator";
import { EmptyState } from "@/tui/components/empty-state";
import { funnel } from "@/tui/theme";
import { useHasciiTheme } from "@/tui/utils/hascii/theme-context";
import type { ProfileConfig } from "@/engine/settings/settings-schema";

type Props = {
  active: boolean;
  profiles: ProfileConfig[];
  selectedIndex: number;
};

/**
 * Modal-style overlay: pick a profile and launch Claude Code via the same
 * code path as `fnl claude --profile`. The launcher exits the TUI before
 * exec'ing so Claude takes over the terminal.
 */
export function ProfileLauncher(props: Props) {
  const theme = useHasciiTheme();

  if (!props.active) return null;

  return (
    <box
      style={{
        flexDirection: "column",
        backgroundColor: funnel.surface,
        paddingLeft: funnel.paddingX,
        paddingRight: funnel.paddingX,
        paddingTop: funnel.paddingY,
        paddingBottom: funnel.paddingY,
        gap: funnel.gap,
        position: "absolute",
        top: funnel.modalTop,
        left: funnel.modalInset,
        right: funnel.modalInset,
      }}
    >
      <text fg={theme.color.foreground}>launch claude with profile</text>
      <HasciiSeparator />

      {props.profiles.length === 0 ? (
        <EmptyState message="(no profiles — `fnl profiles add` first)" />
      ) : (
        props.profiles.map((profile, index) => {
          const selected = index === props.selectedIndex;

          return (
            <text key={profile.name} bg={selected ? theme.color.muted : undefined}>
              <span fg={theme.color.foreground}>{profile.name}</span>
              <span fg={funnel.faint}>
                {`  → channel ${profile.channel}${profile.repo ? ` · repo ${profile.repo}` : ""}`}
              </span>
            </text>
          );
        })
      )}
    </box>
  );
}
