import type { Hono } from "hono"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { FunnelChannels, type AddConnectorInput } from "@/engine/channels/channels"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import type { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import type { ChannelDeliveryMode } from "@/engine/settings/settings-schema"
import type { FunnelClock } from "@/engine/time/clock"
import type { FunnelHttpClient } from "@/engine/http/http-client"
import type { FunnelLogger } from "@/engine/logger/logger"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { FunnelGatewayModule } from "@/gateway/gateway-module"
import { FunnelGatewayServer } from "@/gateway/gateway-server"
import type { FunnelEventLog } from "@/gateway/event-log/event-log"
import type { Env } from "@/gateway/factory"

export type FunnelChannelOptions = {
  name: string
  delivery?: ChannelDeliveryMode
  connectors?: AddConnectorInput[]
}

export type FunnelOptions = {
  channels?: FunnelChannelOptions[]
  connectors?: ConnectorDescriptor[]
  /** Optional host-owned configuration store. Defaults to memory. */
  store?: FunnelSettingsReader
  clock?: FunnelClock
  http?: FunnelHttpClient
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  onError?: OnFunnelError
  signal?: AbortSignal
}

export type GatewayModuleOptions = {
  /** Host-owned durable replay, if needed. Default replay is bounded in memory. */
  eventLog?: FunnelEventLog
  /** Explicit host authentication. No token files are created. */
  token: string
  extraRoutes?: Hono<Env>
  healthRoute?: boolean
}

export type GatewayServerOptions = GatewayModuleOptions & {
  /** The host chooses the port; zero requests an ephemeral port. */
  port: number
  hostname?: string
  allowInsecureHost?: boolean
}

/** Connect external sources to channel subscribers. No directories, processes or agent runtime. */
export class Funnel {
  readonly channels: FunnelChannels

  constructor(private readonly options: FunnelOptions = {}) {
    if (options.store && options.channels) throw new Error("pass channels or store, not both")
    const store = options.store ?? new MemoryFunnelSettingsStore()
    const registry = new FunnelConnectorRegistry({
      descriptors: options.connectors ?? [],
      http: options.http,
      clock: options.clock,
      logger: options.logger,
      diagnosticLog: options.diagnosticLog,
      signal: options.signal,
    })
    this.channels = new FunnelChannels({ store, registry, clock: options.clock })
    for (const channel of options.channels ?? []) {
      this.channels.add({ name: channel.name, delivery: channel.delivery })
      for (const connector of channel.connectors ?? [])
        this.channels.addConnector(channel.name, connector)
    }
    Object.freeze(this)
  }

  gatewayModule(options: GatewayModuleOptions): FunnelGatewayModule {
    return new FunnelGatewayModule({
      ...options,
      channels: this.channels,
      clock: this.options.clock,
      logger: this.options.logger,
      onError: this.options.onError,
      signal: this.options.signal,
      diagnosticLog: this.options.diagnosticLog,
    })
  }

  gatewayServer(options: GatewayServerOptions): FunnelGatewayServer {
    return new FunnelGatewayServer({
      ...options,
      channels: this.channels,
      clock: this.options.clock,
      logger: this.options.logger,
      onError: this.options.onError,
      signal: this.options.signal,
      diagnosticLog: this.options.diagnosticLog,
    })
  }
}
