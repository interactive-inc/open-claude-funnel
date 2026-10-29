import type { Server, ServerWebSocket, WebSocketHandler } from "bun"
import type { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import type { FunnelChannels } from "@/engine/channels/channels"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import {
  FunnelChannelAmbiguousError,
  FunnelChannelNotFoundError,
  FunnelConnectorNotFoundError,
} from "@/engine/error/funnel-error"
import { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelClock } from "@/engine/time/clock"
import { constantTimeEqual, requireBearerToken } from "@/gateway/auth-middleware"
import { type BroadcastSubscriber, FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { FunnelEventLog } from "@/gateway/event-log/event-log"
import { type Env, factory } from "@/gateway/factory"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { gatewayRoutes, gatewayRoutesWithoutHealth } from "@/gateway/routes"
import type { EventStreamOptions, FunnelEventSubscription } from "@/gateway/event-stream"
import { WebSocketBackpressureError } from "@/gateway/errors"
import { invokeCallback } from "@/invoke-callback"
import { logInfo } from "@/gateway/log-info"
import { requireTimestamp } from "@/require-timestamp"
import type { GatewayEmitInput } from "@/gateway/routes/route-deps"

export type GatewayEventsOptions = EventStreamOptions & {
  channel: string
  /** Required for exclusive delivery; also receives meta.target addressed to this id. */
  subscriberId?: string
  /** Replay retained events strictly after this offset, then continue live. */
  since?: number
}

export type GatewayEventStore = { eventLog?: FunnelEventLog }
type ResolvedChannel = {
  id: string
  name: string
  connectors: string[]
  connectorIds: string[]
  delivery: "fanout" | "exclusive"
}

export type GatewayModuleDeps = GatewayEventStore & {
  channels: FunnelChannels
  clock?: FunnelClock
  logger?: FunnelLogger
  onError?: OnFunnelError
  token: string
  signal?: AbortSignal
  extraRoutes?: Hono<Env>
  diagnosticLog?: ConnectorDiagnosticLog
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
  connectorIds?: string[]
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

  private readonly channels: FunnelChannels
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError
  private readonly token: string
  private readonly broadcaster: FunnelBroadcaster
  private readonly eventLog: FunnelEventLog
  private readonly registry: FunnelListenerRegistry
  private readonly nowMs: () => number
  private readonly ownsEventLog: boolean
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private readonly healthRoute: boolean
  private startedAt: number | null = null
  private readonly signal: AbortSignal | undefined
  private readonly callController = new AbortController()
  private readonly onAbort: () => void
  private stopPromise: Promise<void> | null = null
  private startPromise: Promise<void> | null = null
  private disposed = false

  constructor(deps: GatewayModuleDeps) {
    if (typeof deps.token !== "string")
      throw new Error("token is required; use an empty string only with host-owned authentication")
    this.signal = deps.signal
    this.onAbort = () => {
      invokeCallback(
        () => this.stop(),
        (error: unknown) =>
          this.onError(error instanceof Error ? error : new Error(String(error)), {
            component: "gateway-stop",
          }),
      )
    }
    this.channels = deps.channels
    this.logger = deps.logger
    this.onError = deps.onError ?? defaultOnError
    this.token = deps.token ?? ""
    this.diagnosticLog = deps.diagnosticLog
    // Read before buildApp() below, which branches on it.
    this.healthRoute = deps.healthRoute ?? true
    const clock = deps.clock
    this.nowMs = () => requireTimestamp(clock ? clock.millis() : Date.now())

    this.eventLog =
      deps.eventLog ?? new MemoryFunnelEventLog({ maxRows: 200, maxBytes: 4 * 1024 * 1024 })
    this.ownsEventLog = deps.eventLog === undefined

    this.broadcaster = new FunnelBroadcaster({
      logger: this.logger,
      onError: this.onError,
      now: this.nowMs,
      persistentReplay: this.eventLog,
      channels: () =>
        this.channels.list().map((channel) => ({
          id: channel.id,
          connectors: channel.connectors.map((connector) => connector.name),
          connectorIds: channel.connectors.map((connector) => connector.id),
          delivery: channel.delivery,
        })),
      record: (event) => {
        if (this.disposed || this.stopPromise || this.signal?.aborted)
          throw new Error("gateway is stopped")
        return this.eventLog.record({
          content: event.content,
          channelId: event.meta?.channelId ?? null,
          connectorId: event.meta?.connectorId ?? null,
          meta: event.meta ?? null,
          offset: event.offset,
          ...(event.exclusive ? { exclusive: event.exclusive } : {}),
        })
      },
    })
    this.broadcaster.seedLatestOffset(this.eventLog.findMaxOffset())
    this.registry = new FunnelListenerRegistry({
      channels: this.channels,
      logger: this.logger,
      onError: this.onError,
      notify: async (_channelName, _connectorName, content, meta, identity) => {
        const channel = this.resolveChannel(identity.channelId, "id")
        if (!channel) throw new FunnelChannelNotFoundError(identity.channelId)
        const index = channel.connectorIds.indexOf(identity.connectorId)
        if (index < 0) throw new FunnelConnectorNotFoundError(channel.name, identity.connectorId)
        this.emitResolved(channel, {
          channel: channel.name,
          connector: channel.connectors[index],
          content,
          meta,
        })
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
    if (!this.signal?.aborted) this.signal?.addEventListener("abort", this.onAbort, { once: true })
  }

  /** Start this connection group. Process lifecycle belongs to the host. */
  async start(): Promise<void> {
    this.signal?.throwIfAborted()
    if (this.disposed || this.stopPromise) {
      // Restarting after dispose() would boot listeners against a closed event
      // log. Surface this invalid lifecycle instead of starting listeners that
      // cannot publish, matching FunnelGatewayServer's single-use contract.
      throw new Error("FunnelGatewayModule is single-use: construct a new instance to start again")
    }
    if (this.startPromise) return this.startPromise
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
    // Stamp on every attempt, matching the pre-split server: if a previous
    // attempt rolled back after its listeners failed to boot, a retry must
    // measure uptime from the attempt that actually succeeded, not from the
    // failed one.
    this.startedAt = this.nowMs()
    try {
      await this.bootListeners()
      this.signal?.throwIfAborted()
      if (this.disposed || this.stopPromise) throw new Error("gateway stopped during startup")
    } catch (error) {
      try {
        await this.registry.stopAll()
      } catch (cleanupError) {
        invokeCallback(() =>
          this.onError(
            cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
            { component: "gateway-start-cleanup" },
          ),
        )
      }
      throw error
    }
  }

  /** Stop the listeners. Does not touch the event log — see `dispose()`. */
  async stopListeners(): Promise<void> {
    await this.registry.stopAll()
  }

  /** Seal the gateway and release subscriptions/owned storage. Use stop() to await source cleanup. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.broadcaster.closeObservers()
    invokeCallback(
      () => this.registry.close(),
      (error) =>
        this.onError(error instanceof Error ? error : new Error(String(error)), {
          component: "gateway-dispose",
        }),
    )
    this.callController.abort()
    this.broadcaster.closeEventStreams()
    this.broadcaster.closeClients()
    this.signal?.removeEventListener("abort", this.onAbort)
    if (this.ownsEventLog) this.eventLog.close()
  }

  /** Stop listeners and release the owned event log. */
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    const completion = Promise.withResolvers<void>()
    this.stopPromise = completion.promise
    this.broadcaster.closeObservers()
    const stopping = (async () => {
      try {
        const closing = this.registry.close()
        this.callController.abort()
        this.broadcaster.closeEventStreams()
        this.broadcaster.closeClients()
        await closing
      } finally {
        this.dispose()
      }
    })()
    void stopping.then(completion.resolve, completion.reject)
    return completion.promise
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
    if (this.disposed || this.stopPromise || this.signal?.aborted) {
      return { handled: true, response: new Response("gateway is stopped", { status: 503 }) }
    }

    const requestedChannel = url.searchParams.get("channel") ?? ""
    if (!requestedChannel) {
      return { handled: true, response: new Response("channel is required", { status: 400 }) }
    }
    let channel: ResolvedChannel | null
    try {
      channel = this.resolveChannel(requestedChannel)
    } catch (error) {
      if (error instanceof FunnelChannelAmbiguousError)
        return { handled: true, response: new Response(error.message, { status: 400 }) }
      throw error
    }
    // A host settings reader can synchronously initiate shutdown.
    if (this.disposed || this.stopPromise || this.signal?.aborted)
      return { handled: true, response: new Response("gateway is stopped", { status: 503 }) }

    if (!channel) {
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
    const since = sinceRaw === null ? undefined : Number(sinceRaw)
    if (sinceRaw !== null && (!/^\d+$/.test(sinceRaw) || !Number.isSafeInteger(since))) {
      return {
        handled: true,
        response: new Response("since must be a non-negative safe integer", { status: 400 }),
      }
    }
    const subscriberId = url.searchParams.get("id") || undefined

    if (channel.delivery === "exclusive" && since !== undefined && !subscriberId) {
      return {
        handled: true,
        response: new Response("exclusive replay requires a stable subscriber id", { status: 400 }),
      }
    }
    const upgraded = server.upgrade(request, {
      data: {
        channel: channel.id,
        channelName: channel.name,
        connectors: channel.connectors,
        connectorIds: channel.connectorIds,
        delivery: channel.delivery,
        subscriberId,
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
   * hosts / `new Funnel(...)` running their own gateway); another
   * process cannot be observed this way — use a WS client for that.
   */
  onEvent(handler: BroadcastSubscriber): () => void {
    if (this.disposed || this.stopPromise || this.signal?.aborted)
      throw new Error("gateway is stopped")
    return this.broadcaster.subscribe(handler)
  }

  /** Subscribe without HTTP or a WebSocket. return(), abort and gateway shutdown detach immediately. */
  events(options: GatewayEventsOptions): FunnelEventSubscription {
    if (this.disposed || this.stopPromise || this.signal?.aborted)
      throw new Error("gateway is stopped")
    const channel = this.resolveChannel(options.channel)
    if (this.disposed || this.stopPromise || this.signal?.aborted)
      throw new Error("gateway is stopped")
    if (!channel) throw new FunnelChannelNotFoundError(options.channel)
    this.broadcaster.updateChannel(channel.id, channel)
    const subscription = this.broadcaster.events(
      {
        channel: channel.id,
        channelName: channel.name,
        connectors: channel.connectors,
        connectorIds: channel.connectorIds,
        delivery: channel.delivery,
        subscriberId: options.subscriberId,
      },
      options,
    )
    // Option getters can stop the gateway before the new stream is registered.
    if (this.disposed || this.stopPromise || this.signal?.aborted) {
      void subscription.return()
      throw new Error("gateway is stopped")
    }
    return subscription
  }

  /**
   * Broadcast `content` to subscribers of `channel`, persisting the event in
   * the event log and stamping `meta.channel{,Id}` / `meta.connector{,Id}`
   * when they resolve. Used by both the connector-listener path (via the
   * listener registry's `notify` callback) and the public `/channels/:channel/publish`
   * route. Returns the assigned event offset.
   *
   * The host can publish in-process without an HTTP request.
   */
  emit(input: GatewayEmitInput): { offset: number } {
    if (this.disposed || this.stopPromise || this.signal?.aborted)
      throw new Error("gateway is stopped")
    const channel = this.resolveChannel(input.channel)

    if (!channel) throw new FunnelChannelNotFoundError(input.channel)

    return this.emitResolved(channel, input)
  }

  private emitResolved(channel: ResolvedChannel, input: GatewayEmitInput): { offset: number } {
    if (this.disposed || this.stopPromise || this.signal?.aborted)
      throw new Error("gateway is stopped")
    const channelId = channel.id
    this.broadcaster.updateChannel(channel.id, channel)
    const connectorId =
      input.connector === undefined
        ? undefined
        : channel.connectorIds[channel.connectors.indexOf(input.connector)]
    const enriched: Record<string, string> = {
      ...input.meta,
      channel: input.channel,
    }
    delete enriched.connector
    delete enriched.connectorId

    if (input.connector !== undefined) enriched.connector = input.connector
    if (channelId) enriched.channelId = channelId
    if (connectorId) enriched.connectorId = connectorId

    const event = this.broadcaster.broadcast(input.content, enriched)

    return { offset: event.offset }
  }

  private buildApp(extraRoutes: Hono<Env> | null): Hono<Env> {
    const base = factory.createApp()

    base.use((c, next) => {
      c.set("deps", {
        broadcaster: this.broadcaster,
        registry: this.registry,
        channels: this.channels,
        uptimeMs: () => (this.startedAt !== null ? this.nowMs() - this.startedAt : 0),
        emit: (input) => this.emit(input),
        assertActive: () => this.assertHttpActive(),
        callSignal: this.callController.signal,
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

    const requireActive = factory.createMiddleware(async (_context, next) => {
      this.assertHttpActive()
      await next()
    })
    base.use("/listeners/*", requireActive)
    base.use("/channels/*", requireActive)
    base.use("/status", requireActive)
    base.use("/debug", requireActive)
    if (this.healthRoute) base.use("/health", requireActive)

    const withExtras = extraRoutes ? base.route("/", extraRoutes) : base
    return withExtras.route("/", this.healthRoute ? gatewayRoutes : gatewayRoutesWithoutHealth)
  }

  private handleWsOpen(ws: ServerWebSocket<GatewayWsData>): void {
    const isStopped = () => this.disposed || this.stopPromise !== null || !!this.signal?.aborted
    const isCancelled = () => isStopped() || ws.readyState !== 1
    const closeStopped = () => {
      if (!isStopped()) return
      try {
        ws.close(1001, "gateway stopped")
      } catch {
        // The peer may already have closed the transport.
      }
    }
    if (isCancelled()) {
      closeStopped()
      return
    }
    if (typeof ws.data.since === "number") {
      // A partial replay must close the subscription so the consumer can resume
      // from its last handled offset rather than wait forever for live input.
      try {
        this.broadcaster.replayToClient(ws, ws.data.since, ws.data, isCancelled)
      } catch (error) {
        if (isCancelled()) {
          closeStopped()
          return
        }
        const err = error instanceof Error ? error : new Error(String(error))
        try {
          if (err instanceof WebSocketBackpressureError) ws.close(1009, "backpressure")
          else ws.close(1011, "replay failed")
        } catch {
          // The peer may already have closed the transport.
        }
        invokeCallback(() =>
          this.logger?.warn("replay failed during ws.open", { error: err.message }),
        )
        invokeCallback(() => this.onError(err, { component: "gateway-server.replay" }))
        return
      }
    }

    if (isCancelled()) {
      closeStopped()
      return
    }
    this.broadcaster.addClient(ws, ws.data)

    logInfo(this.logger, this.onError, "channel connected", {
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

    logInfo(this.logger, this.onError, "channel disconnected", {
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
   * Returns true on a constant-time match against the host token.
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
    mode: "name-or-id" | "id" = "name-or-id",
  ): ResolvedChannel | null {
    const channels = this.channels.list()
    const byName =
      mode === "name-or-id" ? channels.find((channel) => channel.name === requested) : undefined
    const byId = channels.find((channel) => channel.id === requested)
    if (byName && byId && byName.id !== byId.id) throw new FunnelChannelAmbiguousError(requested)
    const channel = byName ?? byId

    if (!channel) return null

    return {
      id: channel.id,
      name: channel.name,
      connectors: channel.connectors.map((c) => c.name),
      connectorIds: channel.connectors.map((c) => c.id),
      delivery: channel.delivery,
    }
  }

  private async bootListeners(): Promise<void> {
    await this.registry.startAll()

    for (const entry of this.registry.list()) {
      logInfo(this.logger, this.onError, `${entry.type} listener started: ${entry.name}`, {
        event_type: "system",
        action: `${entry.type}_connect`,
        channel: entry.channelName,
        connector: entry.name,
      })
    }

    logInfo(this.logger, this.onError, "funnel gateway running")
  }

  private assertHttpActive(): void {
    if (this.disposed || this.stopPromise || this.signal?.aborted)
      throw new HTTPException(503, {
        res: Response.json({ ok: false, reason: "gateway is stopped" }, { status: 503 }),
      })
  }
}
