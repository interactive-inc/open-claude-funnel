import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Server, ServerWebSocket } from "bun"
import type { Hono } from "hono"
import type { FunnelChannels } from "@/engine/channels/channels"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { constantTimeEqual, requireBearerToken } from "@/gateway/auth-middleware"
import { type Env, factory } from "@/gateway/factory"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { FunnelEventStore } from "@/gateway/funnel-event-store"
import { FunnelListenerSupervisor } from "@/gateway/listener-supervisor"
import { killCompetingSlackGateways } from "@/gateway/kill-competing-slack-gateways"
import { gatewayRoutes } from "@/gateway/routes"
import { FunnelLogger } from "@/engine/logger/logger"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import type { FunnelProcessRunner } from "@/engine/process/process-runner"
import type { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import type { FunnelClock } from "@/engine/time/clock"

const DEFAULT_PORT = 9742
const defaultDbPath = (): string => join(funnelTmpDir(), "events.db")

type Deps = {
  channels: FunnelChannels
  settings: FunnelSettingsReader
  port?: number
  /** SQLite event store file path. Parent directory is created on demand. Defaults to `<os.tmpdir()>/funnel/events.db`. */
  dbPath?: string
  process?: FunnelProcessRunner
  clock?: FunnelClock
  logger?: FunnelLogger
  /** Host hook for surfacing internal exceptions (broadcaster / supervisor). Defaults to no-op. */
  onError?: OnFunnelError
  selfPid?: number
  /** Funnel home dir, used to scope kill-competing to daemons rooted at the same dir. Defaults to FUNNEL_DIR. */
  dir?: string
  killCompetingSlack?: boolean
  /** Bearer token required for `/listeners*`, `/status`, and `/ws`. Empty string disables auth (tests only). */
  token?: string
  /**
   * Additional hono app mounted before the built-in gateway routes.
   * Use to embed host-specific endpoints (e.g. an MCP route, custom `/api/*`).
   * Host routes are mounted first; built-in `/listeners`, `/status`,
   * `/channels`, `/health` are mounted after and take precedence on conflict.
   */
  extraRoutes?: Hono<Env>
}

type WsData = {
  /** Stable channel id (uuid) the client subscribed to. "" for tap-all clients. */
  channel: string
  /** Resolved channel name (for log readability). null for tap-all or unknown. */
  channelName: string | null
  /** Connector names belonging to that channel; used by tap-all replay filtering. */
  connectors: string[]
  tapAll?: boolean
  /** Routing mode for this channel; resolved at upgrade time from settings. */
  delivery: "fanout" | "exclusive"
  /** Replay any events with offset strictly greater than this on open, then resume the live stream. */
  since?: number
}

const defaultLogger = new NodeFunnelLogger()
const defaultOnError: OnFunnelError = () => {}

/**
 * In-process gateway: runs `Bun.serve` (HTTP + WebSocket /ws), boots connector
 * listeners through `FunnelListenerSupervisor`, fans events out via
 * `FunnelBroadcaster`, and persists them via `FunnelEventStore` (SQLite).
 * System events (gateway lifecycle, connect/disconnect) flow to `FunnelLogger`
 * instead — keeping the SQLite seq space exclusive to broadcaster traffic so
 * the broadcaster's offset counter and `getMaxSeq()` stay aligned without
 * per-event coordination. Exposes `/listeners` HTTP for runtime
 * start/stop/restart of individual connectors.
 */
export class FunnelGatewayServer {
  private readonly channels: FunnelChannels
  private readonly settings: FunnelSettingsReader
  private readonly port: number
  private readonly dbPath: string
  private readonly process?: FunnelProcessRunner
  private readonly logger: FunnelLogger
  private readonly onError: OnFunnelError
  private readonly selfPid: number
  private readonly dir: string
  private readonly killCompetingSlack: boolean
  private readonly token: string
  private readonly broadcaster: FunnelBroadcaster
  private readonly eventStore: FunnelEventStore
  private readonly supervisor: FunnelListenerSupervisor
  private readonly nowMs: () => number
  private readonly extraRoutes: Hono<Env> | null
  private startedAt: number | null = null
  private server: Server<WsData> | null = null

  constructor(deps: Deps) {
    this.channels = deps.channels
    this.settings = deps.settings
    this.port = deps.port ?? DEFAULT_PORT
    this.dbPath = deps.dbPath ?? defaultDbPath()
    this.process = deps.process
    this.logger = deps.logger ?? defaultLogger
    this.onError = deps.onError ?? defaultOnError
    this.selfPid = deps.selfPid ?? globalThis.process.pid
    this.dir = deps.dir ?? FUNNEL_DIR
    this.killCompetingSlack = deps.killCompetingSlack ?? true
    this.token = deps.token ?? ""
    this.extraRoutes = deps.extraRoutes ?? null
    const clock = deps.clock
    this.nowMs = clock ? () => clock.millis() : () => Date.now()
    const dbDir = dirname(this.dbPath)

    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
    this.eventStore = new FunnelEventStore({
      path: this.dbPath,
      now: this.nowMs,
    })
    this.broadcaster = new FunnelBroadcaster({
      logger: this.logger,
      onError: this.onError,
      now: this.nowMs,
      persistentReplay: this.eventStore,
    })
    this.broadcaster.seedLatestOffset(this.eventStore.findMaxOffset())
    this.supervisor = new FunnelListenerSupervisor({
      channels: this.channels,
      logger: this.logger,
      onError: this.onError,
      notify: async (channelName, connectorName, content, meta) => {
        this.emit({ channel: channelName, connector: connectorName, content, meta })
      },
      now: this.nowMs,
    })
  }

  async start(): Promise<Server<WsData>> {
    if (this.server) return this.server

    const app = this.buildApp()

    this.startedAt = this.nowMs()
    this.server = Bun.serve<WsData>({
      port: this.port,
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
    await this.bootListeners()

    return this.server
  }

  async stop(): Promise<void> {
    await this.supervisor.stopAll()

    if (this.server) {
      this.server.stop()
      this.server = null
    }
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

  getSupervisor(): FunnelListenerSupervisor {
    return this.supervisor
  }

  getEventStore(): FunnelEventStore {
    return this.eventStore
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

      const tapAll = url.searchParams.get("tap") === "all"
      const requestedChannel = tapAll ? "" : (url.searchParams.get("channel") ?? "")
      const channel = !tapAll && requestedChannel ? this.resolveChannel(requestedChannel) : null
      const channelId = tapAll ? "" : (channel?.id ?? requestedChannel)
      const channelName = tapAll ? null : (channel?.name ?? null)
      const connectors = channel?.connectors ?? []
      const delivery = channel?.delivery ?? "fanout"
      const sinceRaw = url.searchParams.get("since")
      const sinceParsed = sinceRaw === null ? Number.NaN : Number.parseInt(sinceRaw, 10)
      const since = Number.isFinite(sinceParsed) && sinceParsed >= 0 ? sinceParsed : undefined
      const upgraded = server.upgrade(request, {
        data: {
          channel: channelId,
          channelName,
          connectors,
          tapAll,
          delivery,
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

      for (const event of replay) ws.send(JSON.stringify(event))
    }

    this.broadcaster.addClient(ws, ws.data)

    if (ws.data.channelName) {
      const meta: Record<string, string> = {
        event_type: "system",
        action: "channel_connect",
        channel: ws.data.channelName,
        channelId: ws.data.channel,
        connectors: ws.data.connectors.join(","),
        total: String(this.broadcaster.getClientCount()),
      }

      this.logger.info("channel connected", meta)
    } else {
      this.logger.info("tap-all client connected", {
        event_type: "system",
        action: "tap_connect",
        total: String(this.broadcaster.getClientCount()),
      })
    }
  }

  private handleWsClose(ws: ServerWebSocket<WsData>): void {
    this.broadcaster.removeClient(ws)

    if (ws.data.channelName) {
      this.logger.info("channel disconnected", {
        event_type: "system",
        action: "channel_disconnect",
        channel: ws.data.channelName,
        channelId: ws.data.channel,
        total: String(this.broadcaster.getClientCount()),
      })
    } else {
      this.logger.info("tap-all client disconnected", {
        event_type: "system",
        action: "tap_disconnect",
        total: String(this.broadcaster.getClientCount()),
      })
    }
  }

  private logServerStarted(): void {
    this.logger.info("gateway started", {
      event_type: "system",
      action: "gateway_start",
      port: String(this.port),
      pid: String(this.selfPid),
    })

    this.logger.info("funnel gateway listening", {
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
        broadcaster: this.broadcaster,
        supervisor: this.supervisor,
        channels: this.channels,
        eventStore: this.eventStore,
        uptimeMs: () => (this.startedAt ? this.nowMs() - this.startedAt : 0),
        emit: (input) => this.emit(input),
      })

      return next()
    })

    if (this.token) {
      base.use("/listeners/*", requireBearerToken({ expected: this.token }))
      base.use("/status", requireBearerToken({ expected: this.token }))
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
    const settings = this.settings.read()
    const channel = settings?.channels.find((c) => c.id === requested || c.name === requested)

    if (!channel) return null

    return {
      id: channel.id,
      name: channel.name,
      connectors: channel.connectors.map((c) => c.name),
      delivery: channel.delivery,
    }
  }

  private async bootListeners(): Promise<void> {
    const allConnectors = this.channels.listAllConnectors()

    if (this.killCompetingSlack && allConnectors.some((c) => c.type === "slack")) {
      const killed = await killCompetingSlackGateways({
        selfPid: this.selfPid,
        dir: this.dir,
        process: this.process,
        logger: this.logger,
      })

      if (killed.length > 0) {
        this.logger.info("killed competing Slack gateway processes", {
          event_type: "system",
          action: "kill_competing",
          pids: killed.join(","),
        })
      }
    }

    await this.supervisor.startAll()

    for (const entry of this.supervisor.list()) {
      this.logger.info(`${entry.type} listener started: ${entry.name}`, {
        event_type: "system",
        action: `${entry.type}_connect`,
        channel: entry.channelName,
        connector: entry.name,
      })
    }

    this.logger.info(`event store: ${this.dbPath}`)
    this.logger.info("funnel gateway running")
  }

  /**
   * Broadcast `content` to subscribers of `channel`, persisting the event in
   * the SQLite store and stamping `meta.channel{,Id}` / `meta.connector{,Id}`
   * when they resolve. Used by both the connector-listener path (via the
   * supervisor's `notify` callback) and the public `/channels/:channel/publish`
   * route. Returns the assigned event offset.
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

    this.eventStore.record({
      content: input.content,
      channelId: channelId ?? null,
      connectorId: connectorId ?? null,
      meta: enriched,
      offset: event.offset,
    })

    return { offset: event.offset }
  }

  private lookupChannelId(channelName: string): string | null {
    const channel = this.settings.read().channels.find((c) => c.name === channelName)

    return channel?.id ?? null
  }

  private lookupConnectorId(channelId: string, connectorName: string): string | null {
    const channel = this.settings.read().channels.find((c) => c.id === channelId)
    const connector = channel?.connectors.find((c) => c.name === connectorName)

    return connector?.id ?? null
  }
}
