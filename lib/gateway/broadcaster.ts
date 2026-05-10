import type { ServerWebSocket } from "bun"
import { FunnelLogger } from "@/engine/logger/logger"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"

const byteLengthOf = (event: { content: string; meta?: Record<string, string> }): number => {
  let bytes = Buffer.byteLength(event.content, "utf-8")

  if (event.meta) {
    for (const [k, v] of Object.entries(event.meta)) {
      bytes += Buffer.byteLength(k, "utf-8") + Buffer.byteLength(v, "utf-8")
    }
  }

  return bytes
}

type ClientData = {
  /** Stable channel id (uuid) that the WS client subscribed to. */
  channel: string
  /** Human-facing channel name resolved at upgrade time, kept for log readability. */
  channelName?: string | null
  /** Connector names belonging to that channel; used by tap-all replay filtering. */
  connectors: string[]
  tapAll?: boolean
  /** Routing mode resolved from channel config at upgrade time. Defaults to fanout. */
  delivery?: "fanout" | "exclusive"
}

export type BroadcastEvent = {
  content: string
  meta?: Record<string, string>
}

export type ReplayableEvent = BroadcastEvent & { offset: number }

export type BroadcastSubscriber = (event: ReplayableEvent) => void

/**
 * Optional persistent replay source. Wired in by the gateway-server with
 * `FunnelEventStore` (SQLite-backed) so reconnects across daemon restarts
 * can recover events older than the in-memory buffer via an indexed
 * `seq > since` range scan.
 */
export type ReplaySource = {
  loadSince(since: number): ReplayableEvent[]
}

type Deps = {
  logger?: FunnelLogger
  maxBufferedBytes?: number
  now?: () => number
  /** Number of recent events kept in the in-memory replay buffer. */
  replayBufferSize?: number
  /** Hard byte cap on replay buffer payloads. Older events are evicted FIFO until under this cap. */
  replayBufferMaxBytes?: number
  /** Persistent replay source consulted when the in-memory buffer cannot satisfy `since`. */
  persistentReplay?: ReplaySource
}

const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024
const DEFAULT_REPLAY_BUFFER_SIZE = 200
const DEFAULT_REPLAY_BUFFER_MAX_BYTES = 4 * 1024 * 1024
const defaultLogger = new NoopFunnelLogger()

export type BroadcasterMetrics = {
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
 * Two outbound paths:
 *   - WS clients connected via the gateway's `/ws` endpoint, scoped per channel
 *   - In-process subscribers registered via `subscribe()` (programmable API)
 *
 * Backpressure: if a WS client's `bufferedAmount` exceeds `maxBufferedBytes`
 * (default 1 MiB), the client is closed with code 1009 and dropped from the
 * registry to keep one slow consumer from blocking the daemon.
 *
 * Replay: every emitted event gets a strictly increasing `offset`. The latest
 * `replayBufferSize` events are kept in memory; reconnecting WS clients can
 * pass `?since=<offset>` and the broadcaster resends matching events before
 * resuming the live stream. The in-memory ring covers short reconnects;
 * older history is served from the SQLite event store wired in as
 * `persistentReplay`.
 */
export class FunnelBroadcaster {
  private readonly clients: Map<ServerWebSocket<unknown>, ClientData> = new Map()
  private readonly subscribers: Set<BroadcastSubscriber> = new Set()
  private readonly logger: FunnelLogger
  private readonly maxBufferedBytes: number
  private readonly now: () => number
  private readonly replayBufferSize: number
  private readonly replayBufferMaxBytes: number
  private readonly replayBuffer: ReplayableEvent[] = []
  private readonly persistentReplay: ReplaySource | null
  private readonly exclusiveCursor = new Map<string, number>()
  private replayBufferBytes = 0
  private eventsBroadcast = 0
  private droppedSlowClients = 0
  private lastBroadcastAt: number | null = null
  private latestOffset = 0

  constructor(deps: Deps = {}) {
    this.logger = deps.logger ?? defaultLogger
    this.maxBufferedBytes = deps.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES
    this.now = deps.now ?? (() => Date.now())
    this.replayBufferSize = Math.max(0, deps.replayBufferSize ?? DEFAULT_REPLAY_BUFFER_SIZE)
    this.replayBufferMaxBytes = Math.max(
      0,
      deps.replayBufferMaxBytes ?? DEFAULT_REPLAY_BUFFER_MAX_BYTES,
    )
    this.persistentReplay = deps.persistentReplay ?? null
  }

  getMetrics(): BroadcasterMetrics {
    return {
      clients: this.clients.size,
      subscribers: this.subscribers.size,
      eventsBroadcast: this.eventsBroadcast,
      droppedSlowClients: this.droppedSlowClients,
      lastBroadcastAt: this.lastBroadcastAt ? new Date(this.lastBroadcastAt).toISOString() : null,
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
   *      is wired in (SQLite), the gap is filled from disk. This covers reconnects across
   *      daemon restarts where the in-memory buffer was lost.
   *
   * Result is sorted ascending by offset and de-duplicated against the in-memory buffer.
   */
  replaySince(since: number, data: ClientData): ReplayableEvent[] {
    const oldestInMemory = this.replayBuffer[0]?.offset
    const needFallback =
      this.persistentReplay && (oldestInMemory === undefined || since < oldestInMemory - 1)
    const fromMemory = this.replayBuffer.filter(
      (event) => event.offset > since && this.matchesClient(event, data),
    )

    if (!needFallback) return fromMemory

    const persisted = this.persistentReplay
      ? this.persistentReplay.loadSince(since).filter((event) => this.matchesClient(event, data))
      : []
    const cutoff = oldestInMemory ?? Number.POSITIVE_INFINITY
    const beforeMemory = persisted.filter((event) => event.offset < cutoff)

    return [...beforeMemory, ...fromMemory]
  }

  private matchesClient(event: BroadcastEvent, data: ClientData): boolean {
    if (data.tapAll) return true

    const channelId = event.meta?.channelId

    if (channelId && channelId !== data.channel) return false

    const connector = event.meta?.connector

    if (!connector) return true

    return data.connectors.includes(connector)
  }

  /**
   * Returns the list of WS clients that should receive `event`. Tap=all clients always
   * receive (passive observation). For each per-channel group:
   *   - fanout → every matching client receives
   *   - exclusive → exactly one client receives, picked round-robin per channel
   */
  private pickRecipients(event: BroadcastEvent): ServerWebSocket<unknown>[] {
    const exclusiveByChannel = new Map<string, ServerWebSocket<unknown>[]>()
    const recipients: ServerWebSocket<unknown>[] = []

    for (const [ws, data] of this.clients) {
      if (!this.matchesClient(event, data)) continue

      if (data.tapAll) {
        recipients.push(ws)
        continue
      }

      if (data.delivery === "exclusive") {
        const list = exclusiveByChannel.get(data.channel) ?? []

        list.push(ws)
        exclusiveByChannel.set(data.channel, list)
        continue
      }

      recipients.push(ws)
    }

    for (const [channel, candidates] of exclusiveByChannel) {
      if (candidates.length === 0) continue

      const cursor = this.exclusiveCursor.get(channel) ?? 0
      const picked = candidates[cursor % candidates.length]

      if (picked) recipients.push(picked)

      this.exclusiveCursor.set(channel, cursor + 1)
    }

    return recipients
  }

  addClient(ws: ServerWebSocket<unknown>, data: ClientData): void {
    this.clients.set(ws, data)
  }

  removeClient(ws: ServerWebSocket<unknown>): void {
    this.clients.delete(ws)
  }

  getClientCount(): number {
    return this.clients.size
  }

  listChannels(): { channel: string; connectors: string[] }[] {
    return [...this.clients.values()].map((d) => ({ ...d }))
  }

  subscribe(handler: BroadcastSubscriber): () => void {
    this.subscribers.add(handler)

    return () => {
      this.subscribers.delete(handler)
    }
  }

  broadcast(content: string, meta?: Record<string, string>): ReplayableEvent {
    this.latestOffset += 1
    const event: ReplayableEvent = { content, meta, offset: this.latestOffset }
    const payload = JSON.stringify(event)
    const connector = meta?.connector

    this.eventsBroadcast += 1
    this.lastBroadcastAt = this.now()

    if (this.replayBufferSize > 0) {
      const eventBytes = byteLengthOf(event)

      this.replayBuffer.push(event)
      this.replayBufferBytes += eventBytes

      while (
        (this.replayBuffer.length > this.replayBufferSize ||
          this.replayBufferBytes > this.replayBufferMaxBytes) &&
        this.replayBuffer.length > 0
      ) {
        const dropped = this.replayBuffer.shift()

        if (dropped) this.replayBufferBytes -= byteLengthOf(dropped)
      }
    }

    const recipients = this.pickRecipients(event)

    for (const ws of recipients) {
      const buffered = ws.getBufferedAmount()

      if (buffered > this.maxBufferedBytes) {
        const data = this.clients.get(ws)

        this.logger.warn("dropping slow WS client (backpressure)", {
          channel: data?.channel,
          buffered,
          max: this.maxBufferedBytes,
        })

        try {
          ws.close(1009, "backpressure")
        } catch {
          // ignore
        }

        this.clients.delete(ws)
        this.droppedSlowClients += 1
        continue
      }

      ws.send(payload)
    }

    for (const handler of this.subscribers) {
      try {
        handler(event)
      } catch (error) {
        this.logger.error("broadcast subscriber threw", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return event
  }

  /** Forward-seed the offset counter (used at startup from the persisted event store). */
  seedLatestOffset(offset: number): void {
    if (offset > this.latestOffset) this.latestOffset = offset
  }
}
