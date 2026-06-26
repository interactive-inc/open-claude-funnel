import { join } from "node:path"
import type { BaseConnectorConfig } from "@/engine/connectors/base-connector-config"
import type { FunnelConnectorAdapter } from "@/engine/connectors/connector-adapter"
import type {
  ConnectorAdapterDeps,
  ConnectorBuildContext,
  ConnectorDescriptor,
  ConnectorListenerDeps,
  ConnectorOperationContext,
  ConnectorUpdateContext,
} from "@/engine/connectors/connector-descriptor"
import type { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelLogger } from "@/engine/logger/logger"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FunnelHttpClient } from "@/engine/http/http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import { FunnelClock } from "@/engine/time/clock"
import { NodeFunnelClock } from "@/engine/time/node-clock"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"

type Deps = {
  /** Connector types this funnel handles. Each is a self-describing descriptor;
   *  importing it is what pulls its (heavy) listener/adapter code into the bundle,
   *  so omitting a type keeps it out entirely. */
  descriptors: ConnectorDescriptor[]
  fs?: FunnelFileSystem
  process?: FunnelProcessRunner
  http?: FunnelHttpClient
  clock?: FunnelClock
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  dir?: string
  /**
   * Shared shutdown signal forwarded to every listener built by this
   * registry. Hosts wire one signal here (e.g. from a per-Funnel
   * AbortController in a SIGTERM handler) and every listener tears down
   * together when it aborts.
   */
  signal?: AbortSignal
}

const defaultFs = new NodeFunnelFileSystem()
const defaultProcess = new NodeFunnelProcessRunner()
const defaultHttp = new NodeFunnelHttpClient()
const defaultClock = new NodeFunnelClock()

/**
 * Dispatches connector work to injected descriptors by `type`. Replaces the old
 * hard-coded factory: core never imports a concrete connector, so listener and
 * adapter code (and their SDKs) is bundled only when the host passes that type's
 * descriptor to `new Funnel({ connectors: [...] })`.
 *
 * `dir` is the funnel home; per-connector state files land at
 * `<dir>/channels/<channel-id>/connectors/<connector-id>/`.
 */
export class FunnelConnectorRegistry {
  private readonly descriptors: Map<string, ConnectorDescriptor>
  private readonly fs: FunnelFileSystem
  private readonly process: FunnelProcessRunner
  private readonly http: FunnelHttpClient
  private readonly clock: FunnelClock
  private readonly logger: FunnelLogger | undefined
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private readonly signal: AbortSignal | undefined
  private readonly dir: string

  constructor(deps: Deps) {
    this.descriptors = new Map(deps.descriptors.map((descriptor) => [descriptor.type, descriptor]))
    this.fs = deps.fs ?? defaultFs
    this.process = deps.process ?? defaultProcess
    this.http = deps.http ?? defaultHttp
    this.clock = deps.clock ?? defaultClock
    this.logger = deps.logger
    this.diagnosticLog = deps.diagnosticLog
    this.signal = deps.signal
    this.dir = deps.dir ?? FUNNEL_DIR
    Object.freeze(this)
  }

  has(type: string): boolean {
    return this.descriptors.has(type)
  }

  types(): string[] {
    return [...this.descriptors.keys()]
  }

  createListener(channelId: string, config: BaseConnectorConfig): FunnelConnectorListener {
    return this.require(config.type).createListener(config, this.listenerDeps(channelId))
  }

  createAdapter(config: BaseConnectorConfig): FunnelConnectorAdapter | null {
    const descriptor = this.require(config.type)

    if (!descriptor.createAdapter) return null

    return descriptor.createAdapter(config, this.adapterDeps())
  }

  secretTokens(config: BaseConnectorConfig): string[] {
    return this.require(config.type).secretTokens(config)
  }

  buildConfig(input: Record<string, unknown>, context: ConnectorBuildContext): BaseConnectorConfig {
    const type = typeof input.type === "string" ? input.type : ""

    return this.require(type).buildConfig(input, context)
  }

  applyUpdate(
    config: BaseConnectorConfig,
    fields: Record<string, unknown>,
    context: ConnectorUpdateContext,
  ): BaseConnectorConfig {
    return this.require(config.type).applyUpdate(config, fields, context)
  }

  runOperation(
    config: BaseConnectorConfig,
    name: string,
    args: unknown,
    context: ConnectorOperationContext,
  ): { config: BaseConnectorConfig; result: unknown } {
    const descriptor = this.require(config.type)
    const operation = descriptor.operations[name]

    if (!operation) {
      throw new Error(`connector type "${config.type}" has no operation "${name}"`)
    }

    return operation({ config, args, context })
  }

  connectorDir(channelId: string, connectorId: string): string {
    return join(this.dir, "channels", channelId, "connectors", connectorId)
  }

  channelDir(channelId: string): string {
    return join(this.dir, "channels", channelId)
  }

  private require(type: string): ConnectorDescriptor {
    const descriptor = this.descriptors.get(type)

    if (!descriptor) {
      throw new Error(
        `unknown connector type "${type}". Pass its descriptor to new Funnel({ connectors: [...] }).`,
      )
    }

    return descriptor
  }

  private listenerDeps(channelId: string): ConnectorListenerDeps {
    return {
      channelId,
      fs: this.fs,
      process: this.process,
      http: this.http,
      clock: this.clock,
      logger: this.logger,
      diagnosticLog: this.diagnosticLog,
      signal: this.signal,
      connectorDir: (channel, connector) => this.connectorDir(channel, connector),
    }
  }

  private adapterDeps(): ConnectorAdapterDeps {
    return {
      fs: this.fs,
      process: this.process,
      http: this.http,
      logger: this.logger,
    }
  }
}
