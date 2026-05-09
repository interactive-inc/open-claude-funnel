// Public API surface for the @interactive-inc/claude-funnel package.
// Organized by layer so consumers can find what they need at a glance.

// Facade
export { Funnel } from "@/funnel"

// Engine — domain
export { FunnelChannels } from "@/engine/channels/channels"
export { FunnelClaude } from "@/engine/claude/claude"
export { FunnelMcp } from "@/engine/mcp/mcp"
export { FunnelProfiles } from "@/engine/profiles/profiles"
export { FunnelSettingsReader } from "@/engine/settings/settings-reader"
export { FunnelSettingsStore } from "@/engine/settings/settings-store"
export { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"

// Engine — boundaries (abstract + Node / Memory implementations)
export { FunnelFileSystem } from "@/engine/fs/file-system"
export { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
export { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"

export { FunnelProcessRunner } from "@/engine/process/process-runner"
export { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
export { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"

export { FunnelLogger } from "@/engine/logger/logger"
export { NodeFunnelLogger } from "@/engine/logger/node-logger"
export { MemoryFunnelLogger, type LogEntry } from "@/engine/logger/memory-logger"
export { NoopFunnelLogger } from "@/engine/logger/noop-logger"

export { FunnelClock } from "@/engine/time/clock"
export { NodeFunnelClock } from "@/engine/time/node-clock"
export { MemoryFunnelClock } from "@/engine/time/memory-clock"

export { FunnelIdGenerator } from "@/engine/id/id-generator"
export { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
export { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"

// Connectors
export { FunnelConnectorFactory } from "@/connectors/connector-factory"

// Gateway
export { FunnelGateway } from "@/gateway/gateway"
export { FunnelGatewayServer } from "@/gateway/gateway-server"
export {
  FunnelBroadcaster,
  type BroadcastEvent,
  type BroadcastSubscriber,
} from "@/gateway/broadcaster"
export { FunnelEventLogger } from "@/gateway/event-logger"
export { FunnelListenerSupervisor } from "@/gateway/listener-supervisor"
export {
  FunnelListenersClient,
  type ListenerEntry,
  type ListenerOpResult,
  type ListListenersResult,
} from "@/gateway/listeners-client"

// Schemas / config types
export type { ConnectorConfig } from "@/connectors/connector-config-schema"
export type { ScheduleConnectorConfig, ScheduleEntry } from "@/connectors/schedule-connector-schema"
export type { ChannelConfig, ProfileConfig, Settings } from "@/engine/settings/settings-schema"
