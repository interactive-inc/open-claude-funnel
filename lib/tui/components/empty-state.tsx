/** @jsxImportSource @opentui/react */
import { funnel } from "@/tui/theme";

type Props = {
  message: string;
};

/** Faint placeholder shown when a list has no items. */
export function EmptyState(props: Props) {
  return <text fg={funnel.faint}>{props.message}</text>;
}
