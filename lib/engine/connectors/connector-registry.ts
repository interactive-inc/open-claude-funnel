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
import { FunnelLogger } from "@/engine/logger/logger"
import { FunnelHttpClient } from "@/engine/http/http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import { FunnelClock } from "@/engine/time/clock"
import { NodeFunnelClock } from "@/engine/time/node-clock"
import { requireSynchronous } from "@/require-synchronous"

type Deps = {
  /** Connector types this funnel handles. Each is a self-describing descriptor;
   *  importing it is what pulls its (heavy) listener/adapter code into the bundle,
   *  so omitting a type keeps it out entirely. */
  descriptors: ConnectorDescriptor[]
  http?: FunnelHttpClient
  clock?: FunnelClock
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  /**
   * Shared shutdown signal forwarded to every listener built by this
   * registry. Hosts wire one signal here (e.g. from a per-Funnel
   * AbortController in a SIGTERM handler) and every listener tears down
   * together when it aborts.
   */
  signal?: AbortSignal
}

const defaultHttp = new NodeFunnelHttpClient()
const defaultClock = new NodeFunnelClock()

/**
 * Dispatches connector work to injected descriptors by `type`. Replaces the old
 * hard-coded factory: core never imports a concrete connector, so listener and
 * adapter code (and their SDKs) is bundled only when the host passes that type's
 * descriptor to `new Funnel({ connectors: [...] })`.
 *
 */
export class FunnelConnectorRegistry {
  private readonly descriptors: Map<string, ConnectorDescriptor>
  private readonly http: FunnelHttpClient
  private readonly clock: FunnelClock
  private readonly logger: FunnelLogger | undefined
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private readonly signal: AbortSignal | undefined

  constructor(deps: Deps) {
    this.descriptors = new Map(deps.descriptors.map((descriptor) => [descriptor.type, descriptor]))
    this.http = deps.http ?? defaultHttp
    this.clock = deps.clock ?? defaultClock
    this.logger = deps.logger
    this.diagnosticLog = deps.diagnosticLog
    this.signal = deps.signal
    Object.freeze(this)
  }

  has(type: string): boolean {
    return this.descriptors.has(type)
  }

  types(): string[] {
    return [...this.descriptors.keys()]
  }

  createListener(channelId: string, config: BaseConnectorConfig): FunnelConnectorListener {
    return requireSynchronous(
      this.require(config.type).createListener(config, this.listenerDeps(channelId)),
      "connector createListener must be synchronous",
    )
  }

  createAdapter(config: BaseConnectorConfig): FunnelConnectorAdapter | null {
    const descriptor = this.require(config.type)
    const createAdapter = descriptor.createAdapter

    if (!createAdapter) return null

    return requireSynchronous(
      createAdapter.call(descriptor, config, this.adapterDeps()),
      "connector createAdapter must be synchronous",
    )
  }

  secretTokens(config: BaseConnectorConfig): string[] {
    return [
      ...requireSynchronous(
        this.require(config.type).secretTokens(config),
        "connector secretTokens must be synchronous",
      ),
    ]
  }

  buildConfig(input: Record<string, unknown>, context: ConnectorBuildContext): BaseConnectorConfig {
    const type = typeof input.type === "string" ? input.type : ""

    return requireSynchronous(
      this.require(type).buildConfig(input, context),
      "connector buildConfig must be synchronous",
    )
  }

  applyUpdate(
    config: BaseConnectorConfig,
    fields: Record<string, unknown>,
    context: ConnectorUpdateContext,
  ): BaseConnectorConfig {
    return requireSynchronous(
      this.require(config.type).applyUpdate(config, fields, context),
      "connector applyUpdate must be synchronous",
    )
  }

  runOperation(
    config: BaseConnectorConfig,
    name: string,
    args: unknown,
    context: ConnectorOperationContext,
  ): { config: BaseConnectorConfig; result: unknown } {
    const descriptor = this.require(config.type)
    const operations = descriptor.operations
    const operation = Object.hasOwn(operations, name) ? operations[name] : undefined

    if (typeof operation !== "function") {
      throw new Error(`connector type "${config.type}" has no operation "${name}"`)
    }

    return requireSynchronous(
      operation({ config, args, context }),
      "connector operation must be synchronous",
    )
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
      http: this.http,
      clock: this.clock,
      logger: this.logger,
      diagnosticLog: this.diagnosticLog,
      signal: this.signal,
    }
  }

  private adapterDeps(): ConnectorAdapterDeps {
    return {
      http: this.http,
      logger: this.logger,
    }
  }
}
