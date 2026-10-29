import type { Server } from "bun"
import type { Hono } from "hono"
import type { FunnelChannels } from "@/engine/channels/channels"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelClock } from "@/engine/time/clock"
import type { BroadcastSubscriber, FunnelBroadcaster } from "@/gateway/broadcaster"
import { FunnelEventLog } from "@/gateway/event-log/event-log"
import type { Env } from "@/gateway/factory"
import {
  FunnelGatewayModule,
  type GatewayEventStore,
  type GatewayWsData,
  type GatewayEventsOptions,
} from "@/gateway/gateway-module"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { logInfo } from "@/gateway/log-info"
import { invokeCallback } from "@/invoke-callback"

export type { GatewayEventStore }

// Bind to loopback by default so the gateway is never reachable off-box. The
// host explicitly chooses a bind address; every privileged
// endpoint still requires the bearer token regardless of the bind address.
const DEFAULT_HOST = "127.0.0.1"
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"])

type Deps = GatewayEventStore & {
  channels: FunnelChannels
  port: number
  hostname?: string
  clock?: FunnelClock
  logger?: FunnelLogger
  onError?: OnFunnelError
  token: string
  signal?: AbortSignal
  allowInsecureHost?: boolean
  extraRoutes?: Hono<Env>
  diagnosticLog?: ConnectorDiagnosticLog
  healthRoute?: boolean
}

/**
 * In-process gateway that owns its listen socket: runs `Bun.serve` (HTTP +
 * WebSocket /ws), boots connector listeners, fans events out, and persists them
 * via a host-supplied `FunnelEventLog` or bounded memory. System events (gateway lifecycle,
 * connect/disconnect) flow to `FunnelLogger` instead — keeping the SQLite seq
 * space exclusive to broadcaster traffic so the broadcaster's offset counter and
 * `getMaxSeq()` stay aligned without per-event coordination. Exposes
 * `/listeners` HTTP for runtime start/stop/restart of individual connectors.
 *
 * The gateway itself lives in `FunnelGatewayModule`; this class only adds the
 * bind. A host that owns its own Hono tree and `Bun.serve` should mount
 * `funnel.gatewayModule()` directly instead of using this class.
 */
export class FunnelGatewayServer {
  private readonly module: FunnelGatewayModule
  private readonly configuredPort: number
  private readonly configuredHostname: string
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError | undefined
  private readonly token: string
  private readonly allowInsecureHost: boolean
  private server: Server<GatewayWsData> | null = null
  private readonly signal: AbortSignal | undefined
  private readonly onAbort: () => void
  private stopPromise: Promise<void> | null = null
  private startPromise: Promise<void> | null = null
  private disposed = false

  constructor(deps: Deps) {
    if (!Number.isInteger(deps.port) || deps.port < 0 || deps.port > 65535)
      throw new Error("port must be an integer between 0 and 65535")
    this.signal = deps.signal
    this.onAbort = () => {
      invokeCallback(
        () => this.stop(),
        (error: unknown) =>
          deps.onError?.(error instanceof Error ? error : new Error(String(error)), {
            component: "gateway-stop",
          }),
      )
    }
    this.configuredPort = deps.port
    this.configuredHostname = deps.hostname ?? DEFAULT_HOST
    this.logger = deps.logger
    this.onError = deps.onError
    this.token = deps.token ?? ""
    this.allowInsecureHost = deps.allowInsecureHost ?? false
    this.module = new FunnelGatewayModule({
      channels: deps.channels,
      // Persistent replay is supplied explicitly by the host.
      eventLog: deps.eventLog,
      clock: deps.clock,
      logger: deps.logger,
      onError: deps.onError,
      token: deps.token,
      extraRoutes: deps.extraRoutes,
      diagnosticLog: deps.diagnosticLog,
      healthRoute: deps.healthRoute,
    })
    // This helper owns the socket; the nested module does not also own shutdown.
    if (!this.signal?.aborted) this.signal?.addEventListener("abort", this.onAbort, { once: true })
  }

  /**
   * The resolved listen port: the live Bun server's port once started (so
   * `port: 0` auto-assignment is visible), the configured value before that.
   */
  get port(): number {
    return this.server?.port ?? this.configuredPort
  }

  /** The bind address: the live Bun server's hostname once started, the configured value before that. */
  get hostname(): string {
    return this.server?.hostname ?? this.configuredHostname
  }

  async start(): Promise<void> {
    this.signal?.throwIfAborted()
    if (this.disposed || this.stopPromise) {
      // A second start() after stop() would silently no-op once `eventLog`
      // was closed, leaving the caller with a dead facade. Surface it loudly
      // so the host knows to construct a fresh instance.
      throw new Error("FunnelGatewayServer is single-use: construct a new instance to start again")
    }

    if (this.startPromise) return this.startPromise
    if (this.server) return
    const completion = Promise.withResolvers<void>()
    this.startPromise = completion.promise
    void this.startAttempt().then(completion.resolve, completion.reject)
    try {
      await completion.promise
    } finally {
      if (this.startPromise === completion.promise) this.startPromise = null
    }
  }

  private async startAttempt(): Promise<void> {
    if (!this.token && !LOOPBACK_HOSTS.has(this.configuredHostname) && !this.allowInsecureHost) {
      // Fail fast: a non-loopback bind with no token would expose every
      // privileged endpoint to the network. Refuse rather than warn — a missed
      // log line has shipped open gateways before. Set a `token`, bind loopback,
      // or pass `allowInsecureHost: true` if you've fronted it with your own auth.
      throw new Error(
        `refusing to start gateway: hostname "${this.configuredHostname}" is reachable off-box but no token is set. ` +
          `Set a token, bind to loopback (127.0.0.1), or pass allowInsecureHost: true.`,
      )
    }

    this.server = Bun.serve<GatewayWsData>({
      port: this.configuredPort,
      hostname: this.configuredHostname,
      development: false,
      fetch: (request, server) => {
        const upgrade = this.module.handleUpgrade(request, server)

        if (upgrade.handled) return upgrade.response

        return this.module.app.fetch(request)
      },
      websocket: this.module.websocket,
    })

    this.logServerStarted()

    // Roll back the Bun.serve binding if listener boot throws; otherwise the
    // host is left with a bound port while no listeners are running.
    try {
      await this.module.start()
      this.signal?.throwIfAborted()
      if (this.disposed || this.stopPromise) throw new Error("gateway stopped during startup")
    } catch (error) {
      this.server?.stop(true)
      this.server = null
      throw error
    }
  }

  stop(): Promise<void> {
    const stopping = this.module.stop()
    this.stopPromise ??= Promise.resolve().then(async () => {
      this.signal?.removeEventListener("abort", this.onAbort)
      this.server?.stop(true)
      this.server = null
      await stopping
      this.disposed = true
    })
    return this.stopPromise
  }

  /**
   * The mountable gateway underneath this server, for reaching parts this
   * class does not re-expose. Read-only use only: calling `stop()` / `dispose()`
   * / `start()` on it bypasses this server's shutdown order and would leave the
   * socket bound over a disposed gateway. Drive the lifecycle through the
   * server's own `start()` / `stop()`.
   */
  getModule(): FunnelGatewayModule {
    return this.module
  }

  getStatus(): { clients: number; channels: { channel: string; connectors: string[] }[] } {
    return this.module.getStatus()
  }

  getBroadcaster(): FunnelBroadcaster {
    return this.module.getBroadcaster()
  }

  getRegistry(): FunnelListenerRegistry {
    return this.module.getRegistry()
  }

  getEventLog(): FunnelEventLog {
    return this.module.getEventLog()
  }

  /**
   * Register an in-process observer for every broadcast event. Fires after
   * the event is fanned out to WS clients and recorded in the event log.
   * Returns an unsubscribe function. Only meaningful in-process (embedded
   * hosts / `new Funnel(...)` running their own gateway-server); a separate
   * daemon process cannot be observed this way — use a WS client for that.
   */
  onEvent(handler: BroadcastSubscriber): () => void {
    return this.module.onEvent(handler)
  }

  events(options: GatewayEventsOptions) {
    if (this.stopPromise || this.signal?.aborted) throw new Error("gateway is stopped")
    return this.module.events(options)
  }

  /**
   * Broadcast `content` to subscribers of `channel`, persisting the event in
   * the SQLite store and stamping `meta.channel{,Id}` / `meta.connector{,Id}`
   * when they resolve. Used by both the connector-listener path (via the
   * listener registry's `notify` callback) and the public `/channels/:channel/publish`
   * route. Returns the assigned event offset.
   *
   * The host can publish in-process without an HTTP request.
   */
  emit(input: {
    channel: string
    connector?: string
    content: string
    meta?: Record<string, string>
  }): { offset: number } {
    if (this.stopPromise || this.signal?.aborted) throw new Error("gateway is stopped")
    return this.module.emit(input)
  }

  private logServerStarted(): void {
    logInfo(this.logger, this.onError, "gateway started", {
      event_type: "system",
      action: "gateway_start",
      port: String(this.port),
    })

    logInfo(this.logger, this.onError, "funnel gateway listening", {
      url: `http://localhost:${this.port}`,
      websocket: `ws://localhost:${this.port}/ws`,
      health: `http://localhost:${this.port}/health`,
    })
  }
}
