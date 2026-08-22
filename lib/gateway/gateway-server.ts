import type { Server } from "bun"
import type { Hono } from "hono"
import type { FunnelChannels } from "@/engine/channels/channels"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelProcessRunner } from "@/engine/process/process-runner"
import { resolveFunnelPort } from "@/engine/settings/settings-store"
import type { FunnelClock } from "@/engine/time/clock"
import type { BroadcastSubscriber, FunnelBroadcaster } from "@/gateway/broadcaster"
import { FunnelEventLog } from "@/gateway/event-log/event-log"
import type { Env } from "@/gateway/factory"
import {
  FunnelGatewayModule,
  type GatewayEventStore,
  type GatewayWsData,
} from "@/gateway/gateway-module"
import { FunnelListenerRegistry } from "@/gateway/listener-registry"

export type { GatewayEventStore }

// Bind to loopback by default so the gateway is never reachable off-box. The
// daemon honors FUNNEL_HOST to expose it deliberately; every privileged
// endpoint still requires the bearer token regardless of the bind address.
const DEFAULT_HOST = "127.0.0.1"
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"])

type Deps = GatewayEventStore & {
  channels: FunnelChannels
  port?: number
  /** Bind address for `Bun.serve`. Defaults to `127.0.0.1` (loopback only). Set to `0.0.0.0` to expose on the network. */
  hostname?: string
  process?: FunnelProcessRunner
  clock?: FunnelClock
  logger?: FunnelLogger
  /** Host hook for surfacing internal exceptions (broadcaster / listener registry). Defaults to no-op. */
  onError?: OnFunnelError
  selfPid?: number
  /** Funnel home dir, used to scope kill-competing to daemons rooted at the same dir. Defaults to FUNNEL_DIR. */
  dir?: string
  /** Runtime directory used by the default replay database. Defaults to `funnelTmpDir()`. */
  tmpDir?: string
  killCompetingSlack?: boolean
  /** Bearer token required for `/listeners*`, `/status`, and `/ws`. Empty string disables auth (tests only). */
  token?: string
  /**
   * Permit binding a non-loopback hostname without a token. Off by default:
   * `start()` throws when `hostname` is reachable off-box and `token` is empty,
   * because every privileged endpoint would then be open to the network. Set
   * this only when you've deliberately fronted the gateway with your own auth.
   */
  allowInsecureHost?: boolean
  /**
   * Additional hono app mounted before the built-in gateway routes.
   * Use to embed host-specific endpoints (e.g. an MCP route, custom `/api/*`).
   * Host routes are mounted first; built-in `/listeners`, `/status`,
   * `/channels`, `/health` are mounted after and take precedence on conflict.
   */
  extraRoutes?: Hono<Env>
  /** Read-side diagnostic source exposed to the built-in debug route. */
  diagnosticLog?: ConnectorDiagnosticLog
}

/**
 * In-process gateway that owns its listen socket: runs `Bun.serve` (HTTP +
 * WebSocket /ws), boots connector listeners, fans events out, and persists them
 * via a `FunnelEventLog` (SQLite by default). System events (gateway lifecycle,
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
  private readonly selfPid: number
  private readonly token: string
  private readonly allowInsecureHost: boolean
  private server: Server<GatewayWsData> | null = null
  private disposed = false

  constructor(deps: Deps) {
    this.configuredPort = deps.port ?? resolveFunnelPort()
    this.configuredHostname = deps.hostname ?? DEFAULT_HOST
    this.logger = deps.logger
    this.selfPid = deps.selfPid ?? globalThis.process.pid
    this.token = deps.token ?? ""
    this.allowInsecureHost = deps.allowInsecureHost ?? false
    this.module = new FunnelGatewayModule({
      channels: deps.channels,
      // EventStore is a union (dbPath xor eventLog); spread it so exactly one reaches the module.
      ...(deps.eventLog ? { eventLog: deps.eventLog } : { dbPath: deps.dbPath }),
      process: deps.process,
      clock: deps.clock,
      logger: deps.logger,
      onError: deps.onError,
      selfPid: deps.selfPid,
      dir: deps.dir,
      tmpDir: deps.tmpDir,
      port: this.configuredPort,
      killCompetingSlack: deps.killCompetingSlack,
      token: deps.token,
      extraRoutes: deps.extraRoutes,
      diagnosticLog: deps.diagnosticLog,
    })
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
    if (this.disposed) {
      // A second start() after stop() would silently no-op once `eventLog`
      // was closed, leaving the caller with a dead facade. Surface it loudly
      // so the host knows to construct a fresh instance.
      throw new Error("FunnelGatewayServer is single-use: construct a new instance to start again")
    }

    if (this.server) return

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

    // Kill any same-dir competitor BEFORE binding and opening our Socket Mode
    // connection. Doing it here (not after the bind) frees the port if a stale
    // same-dir daemon still holds it, and the kill waits for the competitor to
    // exit — so its Slack socket is closed before ours opens. Otherwise two
    // Socket Mode connections with the same token overlap and Slack splits
    // inbound events between them.
    await this.module.killCompetingSlackIfNeeded()

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
    // host is left with `this.server` holding the port (EADDRINUSE on retry)
    // while no listeners are actually running. `module.start()` re-runs the
    // competitor kill as a no-op — it already ran above, before the bind.
    try {
      await this.module.start()
    } catch (error) {
      this.server.stop()
      this.server = null
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.module.stopListeners()

    if (this.server) {
      this.server.stop()
      this.server = null
    }

    this.module.dispose()
    this.disposed = true
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

  /**
   * Broadcast `content` to subscribers of `channel`, persisting the event in
   * the SQLite store and stamping `meta.channel{,Id}` / `meta.connector{,Id}`
   * when they resolve. Used by both the connector-listener path (via the
   * listener registry's `notify` callback) and the public `/channels/:channel/publish`
   * route. Returns the assigned event offset.
   *
   * Public SDK surface for hosts running this gateway in-process — the no-HTTP
   * sibling of `funnel.publisher.publish()`, which targets a daemon instead
   * (see fnl docs programmable-api).
   */
  emit(input: {
    channel: string
    connector?: string
    content: string
    meta?: Record<string, string>
  }): { offset: number } {
    return this.module.emit(input)
  }

  private logServerStarted(): void {
    this.logger?.info("gateway started", {
      event_type: "system",
      action: "gateway_start",
      port: String(this.port),
      pid: String(this.selfPid),
    })

    this.logger?.info("funnel gateway listening", {
      url: `http://localhost:${this.port}`,
      websocket: `ws://localhost:${this.port}/ws`,
      health: `http://localhost:${this.port}/health`,
    })
  }
}
