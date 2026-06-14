import type { BaseConnectorConfig } from "@/engine/connectors/base-connector-config"
import type { FunnelConnectorAdapter } from "@/engine/connectors/connector-adapter"
import type { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { FunnelFileSystem } from "@/engine/fs/file-system"
import type { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelProcessRunner } from "@/engine/process/process-runner"

/** Boundaries a listener needs, supplied by the registry at build time. */
export type ConnectorListenerDeps = {
  channelId: string
  fs: FunnelFileSystem
  process: FunnelProcessRunner
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  /** Resolves the per-connector state directory (`<dir>/channels/<id>/connectors/<id>`). */
  connectorDir: (channelId: string, connectorId: string) => string
}

/** Boundaries an adapter needs. Adapters are channel-agnostic. */
export type ConnectorAdapterDeps = {
  fs: FunnelFileSystem
  process: FunnelProcessRunner
  logger?: FunnelLogger
}

export type ConnectorBuildContext = {
  id: string
  now: string
}

export type ConnectorUpdateContext = {
  now: string
}

export type ConnectorOperationContext = {
  generateId: () => string
  now: string
}

/**
 * One named operation a connector type exposes beyond plain CRUD (e.g. schedule
 * entry add/remove/list). Returns the next config and an arbitrary result; when
 * the returned config is reference-equal to the input, the channels layer treats
 * the call as a read and skips persistence.
 */
export type ConnectorOperation = (props: {
  config: BaseConnectorConfig
  args: unknown
  context: ConnectorOperationContext
}) => { config: BaseConnectorConfig; result: unknown }

/**
 * Everything core needs to handle one connector type, without importing it. A
 * descriptor accepts/returns `BaseConnectorConfig` at every boundary and parses
 * to its concrete config internally (via `schema`), so the registry can hold a
 * homogeneous `ConnectorDescriptor[]` with no variance gymnastics. Type-specific
 * launch hooks (Slack `onAppCreated`, Schedule `onFired`) are closed over by the
 * descriptor factory, not threaded through here. Each descriptor parses configs
 * to its concrete shape internally (it owns its zod schema), so no schema is
 * exposed here — that also sidesteps the variance trap of a `ZodType<Slack>`
 * field declared as `ZodType<BaseConnectorConfig>`.
 */
export type ConnectorDescriptor = {
  type: string
  createListener: (config: BaseConnectorConfig, deps: ConnectorListenerDeps) => FunnelConnectorListener
  createAdapter: ((config: BaseConnectorConfig, deps: ConnectorAdapterDeps) => FunnelConnectorAdapter) | null
  /** Whether the MCP channel server exposes this type as a callable tool. */
  toolExposed: boolean
  secretTokens: (config: BaseConnectorConfig) => string[]
  buildConfig: (input: Record<string, unknown>, context: ConnectorBuildContext) => BaseConnectorConfig
  applyUpdate: (
    config: BaseConnectorConfig,
    fields: Record<string, unknown>,
    context: ConnectorUpdateContext,
  ) => BaseConnectorConfig
  operations: Record<string, ConnectorOperation>
}
