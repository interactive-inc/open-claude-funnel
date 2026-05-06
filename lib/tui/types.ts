import type { ConnectorConfig } from "@/connectors/connector-config-schema";
import type { ListenerEntry } from "@/gateway/listeners-client";
import type { ChannelConfig, ProfileConfig } from "@/engine/settings/settings-schema";

export type Session = {
  channel: string;
  connectors: string[];
};

export type Snapshot = {
  connectors: ConnectorConfig[];
  channels: ChannelConfig[];
  profiles: ProfileConfig[];
  gateway: { running: boolean; pid: number | null; port: number };
  listeners: ListenerEntry[];
  sessions: Session[];
  daemonReachable: boolean;
  refreshedAt: number;
};

export type StreamEvent = {
  id: number;
  receivedAt: number;
  content: string;
  meta: Record<string, string>;
};

export type StreamStatus = "connecting" | "open" | "closed" | "disabled";

export type Mode = "browse" | "filter" | "profile-launcher";

export type View = "events" | "connectors" | "channels" | "profiles" | "listeners";

export type MenuItem = {
  view: View;
  label: string;
  count?: number;
};
