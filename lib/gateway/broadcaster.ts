import { requireIntegerLimit } from "@/require-limit"
import type { ServerWebSocket } from "bun"
import { randomUUID } from "node:crypto"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { FunnelLogger } from "@/engine/logger/logger"
import { eventSnapshot } from "@/gateway/event-snapshot"
import { WebSocketBackpressureError } from "@/gateway/errors"
import { sendWsPayload } from "@/gateway/send-ws-payload"
import { invokeCallback } from "@/invoke-callback"
import { requireTimestamp } from "@/require-timestamp"
import { requireSynchronous } from "@/require-synchronous"
import { errorMessageOf, normalizeError } from "@/engine/error/error-message-of"
import {
  FunnelEventStream,
  type EventStreamOptions,
  type FunnelEventSubscription,
} from "@/gateway/event-stream"

const byteLengthOf = (event: {
  content: string
  meta?: Record<string, string>
  exclusive?: Record<string, string | null>
}): number => {
  let bytes = Buffer.byteLength(event.content, "utf-8")

  if (event.meta) {
    for (const [k, v] of Object.entries(event.meta)) {
      bytes += Buffer.byteLength(k, "utf-8") + Buffer.byteLength(v, "utf-8")
    }
  }

  if (event.exclusive) bytes += Buffer.byteLength(JSON.stringify(event.exclusive), "utf-8")
  return bytes
}

type ClientData = {
  /** Stable channel id (uuid) that the WS client subscribed to. */
  channel: string
  /** Human-facing channel name resolved at upgrade time, kept for log readability. */
  channelName?: string | null
  /** Connector names belonging to that channel. */
  connectors: string[]
  connectorIds?: string[]
  /** Routing mode resolved from channel config at upgrade time. Defaults to fanout. */
  delivery?: "fanout" | "exclusive"
  /**
   * Opaque per-client id declared at upgrade time (`?id=<subscriberId>`). When an
   * event carries `meta.target`, only the client whose `subscriberId` equals it
   * receives the event among that channel's regular subscribers. Targeted delivery
   * is how a publisher addresses one specific instance (e.g. a single agent
   * session) without every subscriber having to receive and discard it.
   */
  subscriberId?: string
}

type Recipient = {
  data: ClientData
} & (
  | { kind: "socket"; target: ServerWebSocket<unknown> }
  | { kind: "stream"; target: FunnelEventStream }
)

export type BroadcastEvent = {
  readonly content: string
  readonly meta?: Readonly<Record<string, string>>
}

const snapshotClientData = (data: ClientData): ClientData => {
  const connectorIds = data.connectorIds
  return {
    channel: data.channel,
    channelName: data.channelName,
    connectors: [...data.connectors],
    connectorIds: connectorIds === undefined ? undefined : [...connectorIds],
    delivery: data.delivery,
    subscriberId: data.subscriberId,
  }
}

export type ReplayableEvent = BroadcastEvent & {
  readonly offset: number
  /** Per-channel exclusive assignment; null means no worker was connected. */
  readonly exclusive?: Readonly<Record<string, string | null>>
}

type PendingEvent = {
  content: string
  meta?: Record<string, string>
  offset: number
  exclusive?: Record<string, string | null>
}

export type BroadcastSubscriber = (event: ReplayableEvent) => void

type ObserverRegistration = { handler: BroadcastSubscriber }

/**
 * Optional persistent replay source. Wired in by the gateway-server with a
 * host-supplied `FunnelEventLog` so reconnects across daemon
 * restarts can recover events older than the in-memory buffer via an indexed
 * `seq > since` range scan.
 */
type ReplaySource = {
  loadSince(since: number, limit?: number): ReplayableEvent[]
  claimExclusive?(offset: number, channelId: string, subscriberId: string): boolean
}

type ChannelSubscription = Pick<ClientData, "connectors" | "connectorIds" | "delivery"> & {
  id: string
}

type Deps = {
  /** Current subscriptions, including exclusive channels with no connected workers. */
  channels?: () => ReadonlyArray<ChannelSubscription>
  logger?: FunnelLogger
  /** Host hook for surfacing subscriber-throw exceptions. Defaults to no-op. */
  onError?: OnFunnelError
  maxBufferedBytes?: number
  now?: () => number
  /** Number of recent events kept in the in-memory replay buffer. */
  replayBufferSize?: number
  /** Hard byte cap on replay buffer payloads. Older events are evicted FIFO until under this cap. */
  replayBufferMaxBytes?: number
  /** Persistent replay source consulted when the in-memory buffer cannot satisfy `since`. */
  persistentReplay?: ReplaySource
  /** Persist synchronously before notifying consumers. Promises/thenables are rejected. */
  record?: (event: ReplayableEvent) => void
}

const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024
const DEFAULT_REPLAY_BUFFER_SIZE = 200
const DEFAULT_REPLAY_BUFFER_MAX_BYTES = 4 * 1024 * 1024
const defaultOnError: OnFunnelError = () => {}

type BroadcasterMetrics = {
  clients: number
  subscribers: number
  eventsBroadcast: number
  droppedSlowClients: number
  lastBroadcastAt: string | null
  /** Latest emitted offset. Clients can `?since=<offset>` to ask for events strictly after this point. */
  latestOffset: number
  /** Oldest offset still held in the replay buffer. Older values cannot be replayed and trigger a full resync. */
  oldestReplayableOffset: number | null
}

/**
 * In-process pub/sub for connector events.
 *
 * Outbound paths:
 *   - WS clients connected via the gateway's `/ws` endpoint, scoped per channel
 *   - In-process subscribers registered via `subscribe()` (programmable API)
 *   - Channel-scoped async input subscriptions created by `events()`
 *
 * Backpressure: if a WS client's `bufferedAmount` exceeds `maxBufferedBytes`
 * (default 1 MiB), the client is closed with code 1009 and dropped from the
 * registry to keep one slow consumer from blocking the daemon.
 *
 * Replay: every emitted event gets a strictly increasing `offset`. The latest
 * `replayBufferSize` events are kept in memory; reconnecting WS clients can
 * pass `?since=<offset>` and the broadcaster resends matching events before
 * resuming the live stream. The in-memory ring covers short reconnects;
 * older history is served from the event log wired in as `persistentReplay`.
 */
export class FunnelBroadcaster {
  private readonly clients: Map<ServerWebSocket<unknown>, ClientData> = new Map()
  private readonly replayingClients = new Map<
    ServerWebSocket<unknown>,
    { registration: ClientData; payloads: string[]; bytes: number }
  >()
  private readonly streams = new Map<FunnelEventStream, ClientData>()
  private readonly subscribers = new Map<BroadcastSubscriber, ObserverRegistration>()
  private observerQueue: { event: ReplayableEvent; observers: ObserverRegistration[] }[] = []
  private notifyingObservers = false
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError
  private readonly maxBufferedBytes: number
  private readonly now: () => number
  private readonly replayBufferSize: number
  private readonly replayBufferMaxBytes: number
  private readonly replayBuffer: ReplayableEvent[] = []
  private readonly persistentReplay: ReplaySource | null
  private readonly channels: Deps["channels"]
  private readonly record: ((event: ReplayableEvent) => void) | undefined
  private readonly exclusiveCursor = new Map<string, number>()
  private readonly channelDelivery = new Map<string, "fanout" | "exclusive">()
  private replayBufferBytes = 0
  private eventsBroadcast = 0
  private droppedSlowClients = 0
  private lastBroadcastAt: number | null = null
  private latestOffset = 0
  private publishing = false

  constructor(deps: Deps = {}) {
    this.logger = deps.logger
    this.onError = deps.onError ?? defaultOnError
    const maxBufferedBytes = deps.maxBufferedBytes
    this.maxBufferedBytes = requireIntegerLimit(
      maxBufferedBytes === undefined ? DEFAULT_MAX_BUFFERED_BYTES : maxBufferedBytes,
      "maxBufferedBytes",
    )
    this.now = deps.now ?? (() => Date.now())
    const replayBufferSize = deps.replayBufferSize
    this.replayBufferSize = requireIntegerLimit(
      replayBufferSize === undefined ? DEFAULT_REPLAY_BUFFER_SIZE : replayBufferSize,
      "replayBufferSize",
    )
    const replayBufferMaxBytes = deps.replayBufferMaxBytes
    this.replayBufferMaxBytes = requireIntegerLimit(
      replayBufferMaxBytes === undefined ? DEFAULT_REPLAY_BUFFER_MAX_BYTES : replayBufferMaxBytes,
      "replayBufferMaxBytes",
    )
    this.persistentReplay = deps.persistentReplay ?? null
    this.channels = deps.channels
    this.record = deps.record
  }

  getMetrics(): BroadcasterMetrics {
    return {
      clients: this.clients.size,
      subscribers: this.subscribers.size + this.streams.size,
      eventsBroadcast: this.eventsBroadcast,
      droppedSlowClients: this.droppedSlowClients,
      lastBroadcastAt:
        this.lastBroadcastAt !== null ? new Date(this.lastBroadcastAt).toISOString() : null,
      latestOffset: this.latestOffset,
      oldestReplayableOffset: this.replayBuffer[0]?.offset ?? null,
    }
  }

  /**
   * Returns events with offset > since, filtered by the connector subscription
   * rules of `data`. Used at WS upgrade time when the client passes `?since=<offset>`.
   *
   * Two-tier lookup:
   *   1. The in-memory ring buffer (covers short reconnects, last `replayBufferSize` events).
   *   2. If `since` predates the oldest in-memory entry and a persistent replay source
   *      is wired in (bounded memory by default), the gap is filled from it. This covers reconnects
   *      across daemon restarts where the in-memory buffer was lost.
   *
   * Result is sorted ascending by offset and de-duplicated against the in-memory buffer.
   */
  replaySince(since: number, data: ClientData): ReplayableEvent[] {
    return [...this.replayEvents(since, snapshotClientData(data))]
  }

  /** Pull replay pages only as sends progress, using the same limits as live delivery. */
  replayToClient(
    ws: ServerWebSocket<unknown>,
    since: number,
    data: ClientData,
    isCancelled?: () => boolean,
  ): void {
    for (const event of this.replayEvents(
      since,
      snapshotClientData(data),
      this.latestOffset,
      isCancelled,
    )) {
      if (isCancelled?.()) return
      sendWsPayload(
        ws,
        JSON.stringify(event),
        this.maxBufferedBytes,
        isCancelled ? () => !isCancelled() : undefined,
      )
    }
  }

  /** Capture the memory boundary now; fetch older history and claim work only as it is read. */
  private replayEvents(
    since: number,
    data: ClientData,
    until?: number,
    isCancelled?: () => boolean,
  ): Generator<ReplayableEvent> {
    const memory = this.replayBuffer.filter(
      (event) => event.offset > since && (until === undefined || event.offset <= until),
    )
    const cutoff = Math.min(
      memory[0]?.offset ?? Infinity,
      until === undefined ? Infinity : until + 1,
    )
    const source = this.persistentReplay
    const matches = (event: ReplayableEvent) => this.matchesReplay(event, data)
    return (function* () {
      let cursor = since
      if (source && since < cutoff - 1) {
        while (true) {
          if (isCancelled?.()) return
          const page = source.loadSince(cursor, 64)
          if (page.length === 0) break
          let atBoundary = false
          for (const record of page) {
            if (isCancelled?.()) return
            const event = eventSnapshot(record)
            if (isCancelled?.()) return
            if (!Number.isSafeInteger(event.offset) || event.offset <= cursor)
              throw new Error("event log replay must advance offsets in ascending order")
            if (event.offset >= cutoff) {
              atBoundary = true
              break
            }
            cursor = event.offset
            if (matches(event)) yield event
          }
          if (atBoundary) break
        }
      }
      for (const event of memory) {
        if (isCancelled?.()) return
        if (matches(event)) yield eventSnapshot(event)
      }
    })()
  }

  private matchesReplay(event: PendingEvent, data: ClientData): boolean {
    if (!this.matchesClient(event, data)) return false

    const assigned =
      event.exclusive && Object.hasOwn(event.exclusive, data.channel)
        ? event.exclusive[data.channel]
        : undefined

    if (assigned === undefined) {
      // Legacy rows do not identify which exclusive worker already saw them.
      return (
        data.delivery !== "exclusive" ||
        (event.meta?.target === data.subscriberId && !!data.subscriberId)
      )
    }

    if (!data.subscriberId) return false
    if (assigned !== null) return assigned === data.subscriberId

    if (this.persistentReplay) {
      const claim = this.persistentReplay.claimExclusive
      if (!claim) return false
      const claimed: unknown = claim.call(
        this.persistentReplay,
        event.offset,
        data.channel,
        data.subscriberId,
      )
      if (claimed instanceof Error) throw claimed
      if (typeof claimed !== "boolean") {
        invokeCallback(
          () => claimed,
          (error) =>
            this.onError(normalizeError(error), {
              component: "broadcaster.claim-exclusive",
              offset: event.offset,
              channelId: data.channel,
            }),
        )
        throw new Error("exclusive claim must return a boolean synchronously")
      }
      if (!claimed) return false
      // Store pages are immutable snapshots. Only cache ownership in an event
      // still owned by this broadcaster's replay buffer.
      if (!this.replayBuffer.includes(event)) return true
    }

    if (event.exclusive) {
      const retained = this.replayBuffer.includes(event)
      const before = retained ? byteLengthOf(event) : 0
      const exclusive = { ...event.exclusive, [data.channel]: data.subscriberId }
      const after = retained ? byteLengthOf({ ...event, exclusive }) : 0
      event.exclusive = exclusive
      if (retained) {
        this.replayBufferBytes += after - before
        this.trimReplayBuffer()
      }
    }
    return true
  }

  private trimReplayBuffer(): void {
    while (
      (this.replayBuffer.length > this.replayBufferSize ||
        this.replayBufferBytes > this.replayBufferMaxBytes) &&
      this.replayBuffer.length > 0
    ) {
      const dropped = this.replayBuffer.shift()
      if (dropped) this.replayBufferBytes -= byteLengthOf(dropped)
    }
  }

  private matchesClient(event: BroadcastEvent, data: ClientData): boolean {
    const target = event.meta?.target

    if (target && target !== data.subscriberId) return false

    const channelId = event.meta?.channelId

    if (channelId && channelId !== data.channel) return false

    const connector = event.meta?.connector
    const connectorId = event.meta?.connectorId

    if (connectorId && data.connectorIds) return data.connectorIds.includes(connectorId)

    if (!connector) return true

    return data.connectors.includes(connector)
  }

  /**
   * Selects socket and in-process recipients together. For each per-channel group:
   *   - fanout → every matching client receives
   *   - exclusive → exactly one client receives, picked round-robin per channel
   *
   * `meta.target` narrows the recipient set via `matchesClient`: only the subscriber
   * whose `subscriberId` equals `target` receives a targeted event.
   */
  private pickRecipients(event: PendingEvent): Recipient[] {
    const exclusiveByChannel = new Map<string, Recipient[]>()
    const recipients: Recipient[] = []
    const channelId = event.meta?.channelId
    const exclusive: Record<string, string | null> = Object.create(null)

    for (const [id, delivery] of this.channelDelivery) {
      if (delivery === "exclusive" && (!channelId || channelId === id)) exclusive[id] = null
    }

    for (const recipient of this.deliveryRecipients()) {
      const { data } = recipient
      if (!this.matchesClient(event, data)) continue

      if (data.delivery === "exclusive") {
        exclusive[data.channel] = null
        const list = exclusiveByChannel.get(data.channel) ?? []

        list.push(recipient)
        exclusiveByChannel.set(data.channel, list)
        continue
      }

      recipients.push(recipient)
    }

    for (const [channel, candidates] of exclusiveByChannel) {
      if (candidates.length === 0) continue

      const cursor = this.exclusiveCursor.get(channel) ?? 0
      const picked = candidates[cursor % candidates.length]

      if (picked) {
        recipients.push(picked)
        picked.data.subscriberId ||= randomUUID()
        exclusive[channel] = picked.data.subscriberId
      }

      this.exclusiveCursor.set(channel, cursor + 1)
    }

    if (Object.keys(exclusive).length > 0) event.exclusive = exclusive

    return recipients
  }

  /** Register before replay; bound and defer live input until history has been sent. */
  addClient(
    ws: ServerWebSocket<unknown>,
    data: ClientData,
    replay?: { since: number; isCancelled?: () => boolean },
  ): void {
    const registration = snapshotClientData(data)
    this.replayingClients.delete(ws)
    this.clients.set(ws, registration)
    if (!replay) return
    const pending = { registration, payloads: [] as string[], bytes: 0 }
    this.replayingClients.set(ws, pending)
    const isCancelled = () => this.clients.get(ws) !== registration || !!replay.isCancelled?.()
    try {
      this.replayToClient(ws, replay.since, registration, isCancelled)
      while (pending.payloads.length > 0 && !isCancelled()) {
        const payload = pending.payloads.shift()!
        pending.bytes -= Buffer.byteLength(payload)
        sendWsPayload(ws, payload, this.maxBufferedBytes, () => !isCancelled())
      }
      if (isCancelled() && this.clients.get(ws) === registration) this.removeClient(ws)
    } catch (error) {
      if (this.clients.get(ws) === registration) this.removeClient(ws)
      throw error
    } finally {
      if (this.replayingClients.get(ws) === pending) this.replayingClients.delete(ws)
    }
  }

  /** Channel-scoped native input for SDKs and host-owned MCP notification loops. */
  events(
    data: ClientData,
    options: EventStreamOptions & { since?: number } = {},
  ): FunnelEventSubscription {
    const subscription = snapshotClientData(data)
    if (subscription.delivery === "exclusive" && !subscription.subscriberId)
      throw new Error("exclusive event streams require a stable subscriber id")
    const since = options.since
    if (since !== undefined && (!Number.isSafeInteger(since) || since < 0))
      throw new Error("since must be a non-negative safe integer")
    let stream: FunnelEventStream | undefined
    const replay =
      since === undefined
        ? undefined
        : this.replayEvents(since, subscription, this.latestOffset, () => stream?.isClosed ?? false)
    stream = new FunnelEventStream(
      options,
      () => {
        if (stream) this.streams.delete(stream)
      },
      replay,
    )
    if (stream.isClosed) return stream
    this.streams.set(stream, subscription)
    return stream
  }

  /** Release monitoring callbacks and discard notifications awaiting dispatch. */
  closeObservers(): void {
    this.subscribers.clear()
    this.observerQueue = []
  }

  closeEventStreams(): void {
    for (const stream of this.streams.keys()) stream.close()
  }

  closeClients(): void {
    // oxlint-disable-next-line unicorn/no-useless-spread -- Close callbacks may mutate the client registry.
    for (const ws of [...this.clients.keys()]) {
      this.removeClient(ws)
      try {
        ws.close(1001, "gateway stopped")
      } catch {}
    }
  }

  private deliveryRecipients(): Recipient[] {
    return [
      ...[...this.clients].map(([target, data]): Recipient => ({ kind: "socket", target, data })),
      ...[...this.streams].map(([target, data]): Recipient => ({ kind: "stream", target, data })),
    ]
  }

  updateChannel(
    channelId: string,
    subscription: Pick<ClientData, "connectors" | "connectorIds" | "delivery">,
  ): void {
    const connectorIds = subscription.connectorIds
    const update = {
      connectors: [...subscription.connectors],
      connectorIds: connectorIds === undefined ? undefined : [...connectorIds],
      delivery: subscription.delivery,
    }
    this.channelDelivery.set(channelId, update.delivery ?? "fanout")
    for (const recipient of this.deliveryRecipients()) {
      const { data } = recipient
      if (data.channel !== channelId) continue
      if (update.delivery === "exclusive" && recipient.kind === "stream" && !data.subscriberId) {
        recipient.target.close(new Error("exclusive event streams require a stable subscriber id"))
        continue
      }

      Object.assign(data, update)
    }
  }

  removeClient(ws: ServerWebSocket<unknown>): void {
    this.clients.delete(ws)
    this.replayingClients.delete(ws)
  }

  getClientCount(): number {
    return this.clients.size
  }

  listChannels(): { channel: string; connectors: string[] }[] {
    return this.deliveryRecipients().map(({ data }) => snapshotClientData(data))
  }

  subscribe(handler: BroadcastSubscriber): () => void {
    const registration = this.subscribers.get(handler) ?? { handler }
    this.subscribers.set(handler, registration)

    return () => {
      if (this.subscribers.get(handler) === registration) this.subscribers.delete(handler)
    }
  }

  broadcast(content: string, meta?: Record<string, string>): ReplayableEvent {
    if (this.publishing) throw new Error("cannot broadcast during event persistence or delivery")
    const observers = [...this.subscribers.values()]
    let delivered: ReplayableEvent
    this.publishing = true
    try {
      delivered = this.deliverEvent(content, meta)
    } finally {
      this.publishing = false
    }

    this.observerQueue.push({ event: delivered, observers })
    this.notifyObservers()

    return delivered
  }

  /** Drain derived publications after every observer has seen the preceding event. */
  private notifyObservers(): void {
    if (this.notifyingObservers) return
    this.notifyingObservers = true
    try {
      while (this.observerQueue.length > 0) {
        const batch = this.observerQueue
        this.observerQueue = []
        for (const { event: delivered, observers } of batch) {
          for (const registration of observers) {
            const { handler } = registration
            if (this.subscribers.get(handler) !== registration) continue
            invokeCallback(
              () => handler(delivered),
              (error) => {
                const err = normalizeError(error)

                invokeCallback(() =>
                  this.logger?.error("broadcast subscriber threw", { error: errorMessageOf(err) }),
                )
                invokeCallback(() =>
                  this.onError(err, {
                    component: "broadcaster.subscriber",
                    offset: delivered.offset,
                    connector: delivered.meta?.connector ?? null,
                    channel: delivered.meta?.channel ?? null,
                  }),
                )
              },
            )
          }
        }
      }
    } finally {
      this.notifyingObservers = false
    }
  }

  /** Persist and complete live delivery before observers may publish derived input. */
  private deliverEvent(content: string, meta?: Record<string, string>): ReplayableEvent {
    if (this.latestOffset >= Number.MAX_SAFE_INTEGER)
      throw new RangeError("event offset range exhausted")
    const broadcastAt = requireTimestamp(this.now())
    if (this.channels) {
      this.channelDelivery.clear()
      for (const channel of this.channels()) this.updateChannel(channel.id, channel)
    }
    this.latestOffset += 1
    const event: PendingEvent = {
      content,
      meta: meta ? Object.freeze({ ...meta }) : undefined,
      offset: this.latestOffset,
    }
    const recipients = this.pickRecipients(event)
    const delivered = eventSnapshot(event)
    const payload = JSON.stringify(delivered)
    const eventBytes = this.replayBufferSize > 0 ? byteLengthOf(event) : 0
    const persisted: unknown = this.record?.(delivered)
    if (persisted instanceof Error) throw persisted
    requireSynchronous(persisted, "event persistence must be synchronous", (error) =>
      this.onError(normalizeError(error), {
        component: "broadcaster.persistence",
        offset: delivered.offset,
      }),
    )

    this.eventsBroadcast += 1
    this.lastBroadcastAt = broadcastAt

    if (this.replayBufferSize > 0) {
      this.replayBuffer.push(event)
      this.replayBufferBytes += eventBytes

      this.trimReplayBuffer()
    }

    for (const recipient of recipients) {
      if (recipient.kind === "stream") {
        if (this.streams.get(recipient.target) !== recipient.data) continue
        recipient.target.push(delivered)
        continue
      }
      const ws = recipient.target
      if (this.clients.get(ws) !== recipient.data) continue
      try {
        const pending = this.replayingClients.get(ws)
        if (pending?.registration === recipient.data) {
          const bytes = Buffer.byteLength(payload)
          if (pending.bytes + bytes > this.maxBufferedBytes)
            throw new WebSocketBackpressureError(pending.bytes + bytes)
          pending.payloads.push(payload)
          pending.bytes += bytes
          continue
        }
        sendWsPayload(
          ws,
          payload,
          this.maxBufferedBytes,
          () => this.clients.get(ws) === recipient.data,
        )
      } catch (error) {
        const err = normalizeError(error)
        if (this.clients.get(ws) !== recipient.data) continue
        const data = recipient.data
        this.removeClient(ws)
        if (err instanceof WebSocketBackpressureError) {
          this.droppedSlowClients += 1
          try {
            ws.close(1009, "backpressure")
          } catch {}
          invokeCallback(() =>
            this.logger?.warn("dropping slow WS client (backpressure)", {
              channel: data?.channel,
              buffered: err.buffered,
              max: this.maxBufferedBytes,
            }),
          )
          continue
        }
        try {
          ws.close(1011, "send failed")
        } catch {}
        invokeCallback(() =>
          this.logger?.warn("ws.send failed; dropping client", {
            channel: data?.channel,
            error: errorMessageOf(err),
          }),
        )
      }
    }

    return delivered
  }

  /** Forward-seed the offset counter (used at startup from the persisted event store). */
  seedLatestOffset(offset: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new RangeError("restored event offset must be a non-negative safe integer")
    if (offset > this.latestOffset) this.latestOffset = offset
  }
}
