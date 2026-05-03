export { Funnel } from "@/funnel"

export { FunnelChannels } from "@/modules/channels/funnel-channels"
export { FunnelClaude } from "@/modules/claude/funnel-claude"
export { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
export {
  type ConnectorStoresBundle,
  createConnectorStores,
} from "@/modules/connectors/funnel-connector-stores"
export { FunnelGateway } from "@/modules/gateway/funnel-gateway"
export { FunnelMcp } from "@/modules/mcp/funnel-mcp"
export { FunnelProfiles } from "@/modules/profiles/funnel-profiles"
export { FunnelRepositories } from "@/modules/repos/funnel-repositories"
export { FunnelSchedule } from "@/modules/schedule/funnel-schedule"

export { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
export { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"
export { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"

export { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
export { FunnelSettingsStore } from "@/modules/settings/funnel-settings-store"
export { MockFunnelSettingsReader } from "@/modules/settings/mock-funnel-settings-reader"

export type { ConnectorConfig } from "@/modules/connectors/connector-config-schema"
export type { ChannelConfig, ProfileConfig, RepositoryConfig, Settings } from "@/modules/settings/settings-schema"
export type { ScheduleConnectorConfig, ScheduleEntry } from "@/modules/connectors/schedule-connector-schema"
