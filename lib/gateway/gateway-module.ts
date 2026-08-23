import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { Server, ServerWebSocket, WebSocketHandler } from "bun"
import type { Hono } from "hono"
import type { FunnelChannels } from "@/engine/channels/channels"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelProcessRunner } from "@/engine/process/process-runner"
import { FUNNEL_DIR, resolveFunnelPort } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import type { FunnelClock } from "@/engine/time/clock"
import { constantTimeEqual, requireBearerToken } from "@/gateway/auth-middleware"
import { type BroadcastSubscriber, FunnelBroadcaster } from "@/gateway/broadcaster"
import { defaultEventDbPath } from "@/gateway/default-event-db-path"
import { FunnelEventLog } from "@/gateway/event-log/event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { type Env, factory } from "@/gateway/factory"
import { killCompetingSlackGateways } from "@/gateway/kill-competing-slack-gateways"
import { FunnelListenerRegistry } from "@/gateway/listener-registry"
import { gatewayRoutes, gatewayRoutesWithoutHealth } from "@/gateway/routes"

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

export type GatewayModuleDeps = GatewayEventStore & {
  channels: FunnelChannels
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
  /**
   * Port used only to name the default replay database (`<tmpDir>/events/<dir>-<port>.db`)
   * so two gateways rooted at the same funnel dir don't share a store. The module
   * never binds — the host owns `Bun.serve`. Ignored when `dbPath`/`eventLog` is given.
   */
  port?: number
  /** Kill same-dir Slack daemons before listeners boot. Defaults to true. */
  killCompetingSlack?: boolean
  /** Bearer token required for `/listeners*`, `/status`, `/debug`, `/channels/*`, and `/ws`. Empty string disables auth (tests only). */
  token?: string
  /**
   * Additional hono app mounted on the module's own app, after the deps and auth
   * middleware but before the built-in routes. Host routes mounted this way can
   * read `c.get("deps")`. Hosts composing their own Hono tree can instead mount
   * `module.app` with `.route("/", module.app)` and keep their routes outside.
   */
  extraRoutes?: Hono<Env>
  /** Read-side diagnostic source exposed to the built-in debug route. */
  diagnosticLog?: ConnectorDiagnosticLog
  /**
   * Mount the built-in unauthenticated `GET /health`. Defaults to true.
   *
   * Set false when the host already serves its own `/health` on the same tree.
   * Without it the two collide and only mount order decides the winner — an
   * implicit condition every host would have to know. The rest of the table
   * (`/status`, `/debug`, `/listeners*`, `/channels/*`, `/ws`) is unaffected.
   */
  healthRoute?: boolean
}

/** Per-connection state Bun carries for an upgraded `/ws` client. */
export type GatewayWsData = {
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

/**
 * Outcome of `handleUpgrade`. Three states, deliberately not collapsed into
 * `Response | undefined`: "upgraded" and "not mine" would both be `undefined`
 * and a host writing `gw.handleUpgrade(req, server) ?? app.fetch(req)` would
 * then answer an already-upgraded socket with a 404 body.
 *
 * - `{ handled: false }` — not a `/ws` upgrade; the host should route it normally
 * - `{ handled: true, response: Response }` — rejected (401 / 404 / 400); return it
 * - `{ handled: true, response: undefined }` — upgraded; return `undefined` to Bun
 */
export type GatewayUpgradeResult =
  | { handled: false; response?: undefined }
  | { handled: true; response: Response | undefined }

const NOT_HANDLED: GatewayUpgradeResult = { handled: false }

const defaultOnError: OnFunnelError = () => {}

/**
 * Mountable in-process gateway. Owns everything the gateway *is* — the Hono
 * route tree (with auth middleware), the `/ws` upgrade decision, the WebSocket
 * handlers, the listener registry, the broadcaster, and the event log — while
 * owning nothing about *where it is bound*. The host supplies `Bun.serve`.
 *
 * ```ts
 * const gw = funnel.gatewayModule({ token, eventLog })
 * const app = new Hono().route("/", hostRoutes).route("/", gw.app)
 *
 * Bun.serve({
 *   port,
 *   fetch: (req, server) => {
 *     const upgrade = gw.handleUpgrade(req, server)
 *     if (upgrade.handled) return upgrade.response
 *     return app.fetch(req)
 *   },
 *   websocket: gw.websocket,
 * })
 *
 * await gw.start()
 * ```
 *
 * `FunnelGatewayServer` is a thin host over this module for callers that want
 * funnel to own the listen socket too.
 */
export class FunnelGatewayModule {
  readonly app: Hono<Env>
  readonly websocket: WebSocketHandler<GatewayWsData>
  readonly dbPath: string

  private readonly channels: FunnelChannels
  private readonly process?: FunnelProcessRunner
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError
  private readonly selfPid: number
  private readonly dir: string
  private readonly killCompetingSlack: boolean
  private readonly token: string
  private readonly broadcaster: FunnelBroadcaster
  private readonly eventLog: FunnelEventLog
  private readonly registry: FunnelListenerRegistry
  private readonly nowMs: () => number
  private readonly ownsEventLog: boolean
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private readonly healthRoute: boolean
  private startedAt: number | null = null
  private disposed = false
  private killRan = false

  constructor(deps: GatewayModuleDeps) {
    this.channels = deps.channels
    this.dir = deps.dir ?? FUNNEL_DIR
    this.dbPath =
      deps.dbPath ??
      defaultEventDbPath({
        tmpDir: deps.tmpDir ?? funnelTmpDir(),
        funnelDir: this.dir,
        port: deps.port ?? resolveFunnelPort(),
      })
    this.process = deps.process
    this.logger = deps.logger
    this.onError = deps.onError ?? defaultOnError
    this.selfPid = deps.selfPid ?? globalThis.process.pid
    this.killCompetingSlack = deps.killCompetingSlack ?? true
    this.token = deps.token ?? ""
    this.diagnosticLog = deps.diagnosticLog
    // Read before buildApp() below, which branches on it.
    this.healthRoute = deps.healthRoute ?? true
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

    this.app = this.buildApp(deps.extraRoutes ?? null)
    this.websocket = {
      open: (ws) => this.handleWsOpen(ws),
      close: (ws) => this.handleWsClose(ws),
      message() {
        // required by Bun's websocket interface; no client → gateway messages today
      },
    }
  }

  /**
   * Kill any same-dir Slack competitor, stamp the uptime origin, and boot the
   * connector listeners.
   *
   * Both of the first two steps are first-call-wins, so a host that binds a
   * port can run `killCompetingSlackIfNeeded()` itself *before* `Bun.serve`
   * (a stale same-dir daemon may still hold the port) and then call `start()`
   * afterwards without the kill running a second time behind its own socket.
   */
  async start(): Promise<void> {
    if (this.disposed) {
      // Restarting after dispose() would boot listeners against a closed event
      // log. emit() broadcasts before it records, so events would reach live
      // subscribers and then vanish from the replay log — a silent durability
      // hole. Surface it instead, matching FunnelGatewayServer's single-use
      // contract.
      throw new Error("FunnelGatewayModule is single-use: construct a new instance to start again")
    }

    await this.killCompetingSlackIfNeeded()
    // Stamp on every attempt, matching the pre-split server: if a previous
    // attempt rolled back after its listeners failed to boot, a retry must
    // measure uptime from the attempt that actually succeeded, not from the
    // failed one.
    this.startedAt = this.nowMs()
    await this.bootListeners()
  }

  /** Stop the listeners. Does not touch the event log — see `dispose()`. */
  async stopListeners(): Promise<void> {
    await this.registry.stopAll()
  }

  /** Close the event log if this module created it. Injected logs are left alone. */
  dispose(): void {
    if (this.ownsEventLog) this.eventLog.close()

    this.disposed = true
  }

  /** Stop listeners and release the owned event log. */
  async stop(): Promise<void> {
    await this.stopListeners()
    this.dispose()
  }

  /**
   * Kill same-dir Slack daemons so their Socket Mode connection is closed
   * before ours opens. A host that binds a port should call this *before*
   * `Bun.serve` — a stale same-dir daemon may still hold the port.
   */
  async killCompetingSlackIfNeeded(): Promise<void> {
    if (!this.killCompetingSlack) return

    // First call wins: a host that runs this before its own bind must not have
    // `start()` repeat it afterwards, which would hunt for competitors while
    // our own socket is already open. The flag marks that the sweep actually
    // ran — setting it before the `hasSlack` check would let a call made while
    // no Slack connector existed suppress the real sweep forever, even though
    // a connector may be added between that call and `start()`.
    if (this.killRan) return

    const hasSlack = this.channels.listAllConnectors().some((c) => c.type === "slack")

    if (!hasSlack) return

    this.killRan = true

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

  /**
   * Decide whether `request` is a `/ws` subscription upgrade and, if so, either
   * upgrade it on `server` or reject it. See `GatewayUpgradeResult` for why the
   * three states are explicit rather than a nullable `Response`.
   */
  handleUpgrade(request: Request, server: Server<GatewayWsData>): GatewayUpgradeResult {
    const url = new URL(request.url)

    if (url.pathname !== "/ws" || request.headers.get("upgrade") !== "websocket") {
      return NOT_HANDLED
    }

    if (this.token && !this.tokenMatchesUpgrade(request)) {
      return { handled: true, response: new Response("unauthorized", { status: 401 }) }
    }

    const requestedChannel = url.searchParams.get("channel") ?? ""
    const channel = requestedChannel ? this.resolveChannel(requestedChannel) : null

    if (requestedChannel && !channel) {
      // Reject rather than upgrade: a client subscribing to a channel this
      // gateway does not know would connect "successfully" and then silently
      // receive nothing (matchesClient filters every event). That is the
      // wrong-gateway-on-a-shared-port failure — surface it instead.
      return {
        handled: true,
        response: new Response(`unknown channel "${requestedChannel}"`, { status: 404 }),
      }
    }

    const sinceRaw = url.searchParams.get("since")
    const sinceParsed = sinceRaw === null ? Number.NaN : Number.parseInt(sinceRaw, 10)
    const since = Number.isFinite(sinceParsed) && sinceParsed >= 0 ? sinceParsed : undefined
    const upgraded = server.upgrade(request, {
      data: {
        channel: channel?.id ?? requestedChannel,
        channelName: channel?.name ?? null,
        connectors: channel?.connectors ?? [],
        delivery: channel?.delivery ?? "fanout",
        subscriberId: url.searchParams.get("id") ?? undefined,
        since,
      },
    })

    if (upgraded) return { handled: true, response: undefined }

    return { handled: true, response: new Response("WebSocket upgrade failed", { status: 400 }) }
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
   * hosts / `new Funnel(...)` running their own gateway); a separate daemon
   * process cannot be observed this way — use a WS client for that.
   */
  onEvent(handler: BroadcastSubscriber): () => void {
    return this.broadcaster.subscribe(handler)
  }

  /**
   * Broadcast `content` to subscribers of `channel`, persisting the event in
   * the event log and stamping `meta.channel{,Id}` / `meta.connector{,Id}`
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

  private buildApp(extraRoutes: Hono<Env> | null): Hono<Env> {
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

    const withExtras = extraRoutes ? base.route("/", extraRoutes) : base
    return withExtras.route("/", this.healthRoute ? gatewayRoutes : gatewayRoutesWithoutHealth)
  }

  private handleWsOpen(ws: ServerWebSocket<GatewayWsData>): void {
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

  private handleWsClose(ws: ServerWebSocket<GatewayWsData>): void {
    this.broadcaster.removeClient(ws)

    this.logger?.info("channel disconnected", {
      event_type: "system",
      action: "channel_disconnect",
      channel: ws.data.channelName ?? "",
      channelId: ws.data.channel,
      total: String(this.broadcaster.getClientCount()),
    })
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
