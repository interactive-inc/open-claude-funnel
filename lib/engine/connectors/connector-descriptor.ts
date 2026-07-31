import type { BaseConnectorConfig } from "@/engine/connectors/base-connector-config"
import type { FunnelConnectorAdapter } from "@/engine/connectors/connector-adapter"
import type { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { FunnelFileSystem } from "@/engine/fs/file-system"
import type { FunnelHttpClient } from "@/engine/http/http-client"
import type { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelProcessRunner } from "@/engine/process/process-runner"
import type { FunnelClock } from "@/engine/time/clock"

/** Boundaries a listener needs, supplied by the registry at build time. */
export type ConnectorListenerDeps = {
  channelId: string
  fs: FunnelFileSystem
  process: FunnelProcessRunner
  /** HTTP client for self-detection (Slack auth.test), reactions, and other listener-side REST calls. */
  http: FunnelHttpClient
  /** Wall clock — listeners that own a timer (schedule) read it from here so tests can inject a fake. */
  clock: FunnelClock
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  /**
   * Optional shutdown signal forwarded to flume-backed listeners. When the
   * host aborts the signal, the listener's Flume tears down its WebSocket /
   * fetch loop without waiting for the listener registry's `stop()`. Hosts that want
   * a clean SIGTERM story wire `controller.signal` here and call
   * `controller.abort()` in their shutdown handler.
   */
  signal?: AbortSignal
  /** Resolves the per-connector state directory (`<dir>/channels/<id>/connectors/<id>`). */
  connectorDir: (channelId: string, connectorId: string) => string
}

/** Boundaries an adapter needs. Adapters are channel-agnostic. */
export type ConnectorAdapterDeps = {
  fs: FunnelFileSystem
  process: FunnelProcessRunner
  /** HTTP client for outbound calls. Used by the Slack adapter, future REST adapters. */
  http: FunnelHttpClient
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
 * launch hooks (e.g. Schedule `onFired`) are closed over by the descriptor
 * factory, not threaded through here. Each descriptor parses configs to its
 * concrete shape internally (it owns its zod schema), so no schema is exposed
 * here — that also sidesteps the variance trap of a `ZodType<Slack>` field
 * declared as `ZodType<BaseConnectorConfig>`.
 */
export type ConnectorDescriptor = {
  type: string
  createListener: (
    config: BaseConnectorConfig,
    deps: ConnectorListenerDeps,
  ) => FunnelConnectorListener
  createAdapter:
    | ((config: BaseConnectorConfig, deps: ConnectorAdapterDeps) => FunnelConnectorAdapter)
    | null
  /** Whether the MCP channel server exposes this type as a callable tool. */
  toolExposed: boolean
  secretTokens: (config: BaseConnectorConfig) => string[]
  buildConfig: (
    input: Record<string, unknown>,
    context: ConnectorBuildContext,
  ) => BaseConnectorConfig
  applyUpdate: (
    config: BaseConnectorConfig,
    fields: Record<string, unknown>,
    context: ConnectorUpdateContext,
  ) => BaseConnectorConfig
  operations: Record<string, ConnectorOperation>
}
