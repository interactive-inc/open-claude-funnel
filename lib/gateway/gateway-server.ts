import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { Server, ServerWebSocket } from "bun"
import type { Hono } from "hono"
import type { FunnelChannels } from "@/engine/channels/channels"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { constantTimeEqual, requireBearerToken } from "@/gateway/auth-middleware"
import { type Env, factory } from "@/gateway/factory"
import { type BroadcastSubscriber, FunnelBroadcaster } from "@/gateway/broadcaster"
import { FunnelEventLog } from "@/gateway/event-log/event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { FunnelListenerRegistry } from "@/gateway/listener-registry"
import { killCompetingSlackGateways } from "@/gateway/kill-competing-slack-gateways"
import { gatewayRoutes } from "@/gateway/routes"
import { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelProcessRunner } from "@/engine/process/process-runner"
import { FUNNEL_DIR, resolveFunnelPort } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import type { FunnelClock } from "@/engine/time/clock"
import { defaultEventDbPath } from "@/gateway/default-event-db-path"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"

// Bind to loopback by default so the gateway is never reachable off-box. The
// daemon honors FUNNEL_HOST to expose it deliberately; every privileged
// endpoint still requires the bearer token regardless of the bind address.
const DEFAULT_HOST = "127.0.0.1"
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"])
/**
 * Where the gateway's durable replay log lives. The two ways to specify it are
 * mutually exclusive — modeled as a union so you can't pass both (the old shape
 * silently ignored `dbPath` when `eventLog` was also given).
 *
 * - omit both → SQLite under `<tmpDir>/events/`, isolated by funnel dir + port
 * - `dbPath` → SQLite at a custom path (parent dir created on demand)
 * - `eventLog` → bring your own `FunnelEventLog` (e.g. `MemoryFunnelEventLog`)
 */
export type GatewayEventStore =
  | { dbPath?: string; eventLog?: undefined }
  | { dbPath?: undefined; eventLog: FunnelEventLog }

type Deps = GatewayEventStore & {
  channels: FunnelChannels
  port?: number
  /** Bind address for `Bun.serve`. Defaults to `127.0.0.1` (loopback only). Set to `0.0.0.0` to expose on the network. */
  hostname?: string
  process?: FunnelProcessRunner
  clock?: FunnelClock
  logger?: FunnelLogger
  /** Host hook for surfacing internal exceptions (broadcaster / supervisor). Defaults to no-op. */
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

type WsData = {
  /** Stable channel id (uuid) the client subscribed to. */
  channel: string
  /** Resolved channel name (for log readability). null for unknown. */
  channelName: string | null
  /** Connector names belonging to that channel. */
  connectors: string[]
  /** Routing mode for this channel; resolved at upgrade time from settings. */
  delivery: "fanout" | "exclusive"
  /** Opaque client id from `?id=<subscriberId>`; lets publishers target this client via `meta.target`. */
  subscriberId?: string
  /** Replay any events with offset strictly greater than this on open, then resume the live stream. */
  since?: number
}

const defaultOnError: OnFunnelError = () => {}

/**
 * In-process gateway: runs `Bun.serve` (HTTP + WebSocket /ws), boots connector
 * listeners through `FunnelListenerRegistry`, fans events out via
 * `FunnelBroadcaster`, and persists them via a `FunnelEventLog` (SQLite by default).
 * System events (gateway lifecycle, connect/disconnect) flow to `FunnelLogger`
 * instead — keeping the SQLite seq space exclusive to broadcaster traffic so
 * the broadcaster's offset counter and `getMaxSeq()` stay aligned without
 * per-event coordination. Exposes `/listeners` HTTP for runtime
 * start/stop/restart of individual connectors.
 */
export class FunnelGatewayServer {
  private readonly channels: FunnelChannels
  private readonly configuredPort: number
  private readonly configuredHostname: string
  private readonly dbPath: string
  private readonly process?: FunnelProcessRunner
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError
  private readonly selfPid: number
  private readonly dir: string
  private readonly killCompetingSlack: boolean
  private readonly token: string
  private readonly allowInsecureHost: boolean
  private readonly broadcaster: FunnelBroadcaster
  private readonly eventLog: FunnelEventLog
  private readonly registry: FunnelListenerRegistry
  private readonly nowMs: () => number
  private readonly extraRoutes: Hono<Env> | null
  private readonly ownsEventLog: boolean
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private startedAt: number | null = null
  private server: Server<WsData> | null = null
  private disposed = false

  constructor(deps: Deps) {
    this.channels = deps.channels
    this.configuredPort = deps.port ?? resolveFunnelPort()
    this.configuredHostname = deps.hostname ?? DEFAULT_HOST
    this.dir = deps.dir ?? FUNNEL_DIR
    this.dbPath =
      deps.dbPath ??
      defaultEventDbPath({
        tmpDir: deps.tmpDir ?? funnelTmpDir(),
        funnelDir: this.dir,
        port: this.configuredPort,
      })
    this.process = deps.process
    this.logger = deps.logger
    this.onError = deps.onError ?? defaultOnError
    this.selfPid = deps.selfPid ?? globalThis.process.pid
    this.killCompetingSlack = deps.killCompetingSlack ?? true
    this.token = deps.token ?? ""
    this.allowInsecureHost = deps.allowInsecureHost ?? false
    this.extraRoutes = deps.extraRoutes ?? null
    this.diagnosticLog = deps.diagnosticLog
    const clock = deps.clock
    this.nowMs = clock ? () => clock.millis() : () => Date.now()
    if (deps.eventLog) {
      this.eventLog = deps.eventLog
      this.ownsEventLog = false
    } else {
      const dbDir = dirname(this.dbPath)

      if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

      this.eventLog = new SqliteFunnelEventLog({
        path: this.dbPath,
        now: this.nowMs,
        logger: this.logger,
        onError: this.onError,
      })
      this.ownsEventLog = true
    }

    this.broadcaster = new FunnelBroadcaster({
      logger: this.logger,
      onError: this.onError,
      now: this.nowMs,
      persistentReplay: this.eventLog,
    })
    this.broadcaster.seedLatestOffset(this.eventLog.findMaxOffset())
    this.registry = new FunnelListenerRegistry({
      channels: this.channels,
      logger: this.logger,
      onError: this.onError,
      notify: async (channelName, connectorName, content, meta) => {
        this.emit({ channel: channelName, connector: connectorName, content, meta })
      },
      now: this.nowMs,
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

    const app = this.buildApp()

    // Kill any same-dir competitor BEFORE binding and opening our Socket Mode
    // connection. Doing it here (not after the bind) frees the port if a stale
    // same-dir daemon still holds it, and the kill waits for the competitor to
    // exit — so its Slack socket is closed before ours opens. Otherwise two
    // Socket Mode connections with the same token overlap and Slack splits
    // inbound events between them.
    await this.killCompetingSlackIfNeeded()

    this.startedAt = this.nowMs()
    this.server = Bun.serve<WsData>({
      port: this.configuredPort,
      hostname: this.configuredHostname,
      development: false,
      fetch: (request, server) => this.handleFetch(request, server, app),
      websocket: {
        open: (ws) => this.handleWsOpen(ws),
        close: (ws) => this.handleWsClose(ws),
        message() {
          // required by Bun's websocket interface; no client → gateway messages today
        },
      },
    })

    this.logServerStarted()

    // Roll back the Bun.serve binding if listener boot throws; otherwise the
    // host is left with `this.server` holding the port (EADDRINUSE on retry)
    // while no listeners are actually running.
    try {
      await this.bootListeners()
    } catch (error) {
      this.server.stop()
      this.server = null
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.registry.stopAll()

    if (this.server) {
      this.server.stop()
      this.server = null
    }

    if (this.ownsEventLog) this.eventLog.close()
    this.disposed = true
  }

  getStatus(): { clients: number; channels: { channel: string; connectors: string[] }[] } {
    return {
      clients: this.broadcaster.getClientCount(),
      channels: this.broadcaster.listChannels(),
    }
  }

  getBroadcaster(): FunnelBroadcaster {
    return this.broadcaster
  }

  getRegistry(): FunnelListenerRegistry {
    return this.registry
  }

  getEventLog(): FunnelEventLog {
    return this.eventLog
  }

  /**
   * Register an in-process observer for every broadcast event. Fires after
   * the event is fanned out to WS clients and recorded in the event log.
   * Returns an unsubscribe function. Only meaningful in-process (embedded
   * hosts / `new Funnel(...)` running their own gateway-server); a separate
   * daemon process cannot be observed this way — use a WS client for that.
   */
  onEvent(handler: BroadcastSubscriber): () => void {
    return this.broadcaster.subscribe(handler)
  }

  private handleFetch(
    request: Request,
    server: Server<WsData>,
    app: Hono<Env>,
  ): Response | Promise<Response> | undefined {
    const url = new URL(request.url)

    if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
      if (this.token && !this.tokenMatchesUpgrade(request)) {
        return new Response("unauthorized", { status: 401 })
      }

      const requestedChannel = url.searchParams.get("channel") ?? ""
      const channel = requestedChannel ? this.resolveChannel(requestedChannel) : null

      if (requestedChannel && !channel) {
        // Reject rather than upgrade: a client subscribing to a channel this
        // gateway does not know would connect "successfully" and then silently
        // receive nothing (matchesClient filters every event). That is the
        // wrong-gateway-on-a-shared-port failure — surface it instead.
        return new Response(`unknown channel "${requestedChannel}"`, { status: 404 })
      }

      const channelId = channel?.id ?? requestedChannel
      const channelName = channel?.name ?? null
      const connectors = channel?.connectors ?? []
      const delivery = channel?.delivery ?? "fanout"
      const sinceRaw = url.searchParams.get("since")
      const sinceParsed = sinceRaw === null ? Number.NaN : Number.parseInt(sinceRaw, 10)
      const since = Number.isFinite(sinceParsed) && sinceParsed >= 0 ? sinceParsed : undefined
      const subscriberId = url.searchParams.get("id") ?? undefined
      const upgraded = server.upgrade(request, {
        data: {
          channel: channelId,
          channelName,
          connectors,
          delivery,
          subscriberId,
          since,
        },
      })

      if (upgraded) return undefined

      return new Response("WebSocket upgrade failed", { status: 400 })
    }

    return app.fetch(request)
  }

  private handleWsOpen(ws: ServerWebSocket<WsData>): void {
    if (typeof ws.data.since === "number") {
      const replay = this.broadcaster.replaySince(ws.data.since, ws.data)

      // ws.send can throw if the client raced a close before we got here.
      // Wrap the whole replay so one failure does not skip both the
      // remaining replay events AND the addClient call below — without
      // the catch, addClient would never run and the client would silently
      // miss live broadcasts.
      try {
        for (const event of replay) ws.send(JSON.stringify(event))
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        this.logger?.warn("replay send failed during ws.open", { error: err.message })
        this.onError(err, { component: "gateway-server.replay" })
        return
      }
    }

    this.broadcaster.addClient(ws, ws.data)

    this.logger?.info("channel connected", {
      event_type: "system",
      action: "channel_connect",
      channel: ws.data.channelName ?? "",
      channelId: ws.data.channel,
      connectors: ws.data.connectors.join(","),
      total: String(this.broadcaster.getClientCount()),
    })
  }

  private handleWsClose(ws: ServerWebSocket<WsData>): void {
    this.broadcaster.removeClient(ws)

    this.logger?.info("channel disconnected", {
      event_type: "system",
      action: "channel_disconnect",
      channel: ws.data.channelName ?? "",
      channelId: ws.data.channel,
      total: String(this.broadcaster.getClientCount()),
    })
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

  private buildApp(): Hono<Env> {
    const base = factory.createApp()

    base.use((c, next) => {
      c.set("deps", {
        selfPid: this.selfPid,
        dir: this.dir,
        broadcaster: this.broadcaster,
        registry: this.registry,
        channels: this.channels,
        uptimeMs: () => (this.startedAt ? this.nowMs() - this.startedAt : 0),
        emit: (input) => this.emit(input),
        diagnosticLog: this.diagnosticLog,
      })

      return next()
    })

    if (this.token) {
      base.use("/listeners/*", requireBearerToken({ expected: this.token }))
      base.use("/status", requireBearerToken({ expected: this.token }))
      base.use("/debug", requireBearerToken({ expected: this.token }))
      base.use("/channels/*", requireBearerToken({ expected: this.token }))
    }

    const withExtras = this.extraRoutes ? base.route("/", this.extraRoutes) : base
    return withExtras.route("/", gatewayRoutes)
  }

  /**
   * Reads the bearer token from the WebSocket upgrade request. Accepts:
   *   - `Sec-WebSocket-Protocol: funnel.token.<value>` (preferred — header, never logged in URLs)
   *   - `Authorization: Bearer <value>` (also header-based)
   * Returns true on a constant-time match against the daemon token.
   */
  private tokenMatchesUpgrade(request: Request): boolean {
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    for (const proto of protocols) {
      if (
        proto.startsWith("funnel.token.") &&
        constantTimeEqual(proto.slice("funnel.token.".length), this.token)
      ) {
        return true
      }
    }

    const auth = request.headers.get("authorization") ?? ""
    const match = auth.match(/^Bearer\s+(.+)$/i)

    if (match && constantTimeEqual(match[1] ?? "", this.token)) return true

    return false
  }

  private resolveChannel(
    requested: string,
  ): { id: string; name: string; connectors: string[]; delivery: "fanout" | "exclusive" } | null {
    const channel = this.channels.get(requested) ?? this.channels.getById(requested)

    if (!channel) return null

    return {
      id: channel.id,
      name: channel.name,
      connectors: channel.connectors.map((c) => c.name),
      delivery: channel.delivery,
    }
  }

  private async killCompetingSlackIfNeeded(): Promise<void> {
    if (!this.killCompetingSlack) return

    const hasSlack = this.channels.listAllConnectors().some((c) => c.type === "slack")

    if (!hasSlack) return

    const killed = await killCompetingSlackGateways({
      selfPid: this.selfPid,
      dir: this.dir,
      process: this.process,
      logger: this.logger,
    })

    if (killed.length > 0) {
      this.logger?.info("killed competing Slack gateway processes", {
        event_type: "system",
        action: "kill_competing",
        pids: killed.join(","),
      })
    }
  }

  private async bootListeners(): Promise<void> {
    await this.registry.startAll()

    for (const entry of this.registry.list()) {
      this.logger?.info(`${entry.type} listener started: ${entry.name}`, {
        event_type: "system",
        action: `${entry.type}_connect`,
        channel: entry.channelName,
        connector: entry.name,
      })
    }

    this.logger?.info(`event store: ${this.dbPath}`)
    this.logger?.info("funnel gateway running")
  }

  /**
   * Broadcast `content` to subscribers of `channel`, persisting the event in
   * the SQLite store and stamping `meta.channel{,Id}` / `meta.connector{,Id}`
   * when they resolve. Used by both the connector-listener path (via the
   * supervisor's `notify` callback) and the public `/channels/:channel/publish`
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
    const channelId = this.lookupChannelId(input.channel)
    const connectorId =
      channelId && input.connector ? this.lookupConnectorId(channelId, input.connector) : null
    const enriched: Record<string, string> = {
      ...input.meta,
      channel: input.channel,
    }

    if (input.connector) enriched.connector = input.connector
    if (channelId) enriched.channelId = channelId
    if (connectorId) enriched.connectorId = connectorId

    const event = this.broadcaster.broadcast(input.content, enriched)

    this.eventLog.record({
      content: input.content,
      channelId: channelId ?? null,
      connectorId: connectorId ?? null,
      meta: enriched,
      offset: event.offset,
    })

    return { offset: event.offset }
  }

  private lookupChannelId(channelName: string): string | null {
    // Resolve by name OR id, matching the WS upgrade path (`resolveChannel`).
    // A caller that publishes by channel id would otherwise leave channelId
    // unstamped, and the broadcaster then skips its channel filter and fans the
    // event out to every connected client regardless of channel.
    return this.channels.get(channelName)?.id ?? this.channels.getById(channelName)?.id ?? null
  }

  private lookupConnectorId(channelId: string, connectorName: string): string | null {
    const channel = this.channels.getById(channelId)

    return channel?.connectors.find((c) => c.name === connectorName)?.id ?? null
  }
}
