import type { Server } from "@modelcontextprotocol/sdk/server/index.js"

const DEFAULT_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 10000

export type ChannelOffsetPort = {
  load: () => number
  save: (offset: number) => void
}

export type WebSocketFactory = (url: string, protocols?: string[]) => WebSocket

type ReconnectScheduler = (callback: () => void, delayMs: number) => unknown

type Props = {
  server: Server
  baseUrl: string
  protocols: string[] | null
  /**
   * Persistence for the broadcaster offset. The MCP child re-spawns on every
   * Claude Code restart and would otherwise reset `lastOffset` to 0, missing
   * events that arrived between the daemon broadcasting them and the new
   * socket opening. With a port wired in, restarts ask the gateway for
   * `?since=<offset>` and the SQLite event store backfills the gap.
   */
  offsetPort?: ChannelOffsetPort
  /** Override the WebSocket constructor for tests. Defaults to globalThis.WebSocket. */
  webSocketFactory?: WebSocketFactory
  /** Initial reconnect delay in ms. Doubles up to MAX_RECONNECT_DELAY. */
  reconnectDelay?: number
  /** Override setTimeout for tests. */
  reconnectScheduler?: ReconnectScheduler
}

type State = {
  reconnectDelay: number
  lastOffset: number
}

/**
 * Subscribes to the gateway WebSocket for a single channel and forwards
 * incoming events to the MCP server as `notifications/claude/channel`.
 * Reconnects with exponential backoff and replays missed events via `?since=<offset>`.
 */
export class FunnelChannelSubscriber {
  private readonly state: State

  constructor(private readonly props: Props) {
    this.state = {
      reconnectDelay: this.initialReconnectDelay,
      lastOffset: props.offsetPort?.load() ?? 0,
    }
    Object.freeze(this)
  }

  start(): void {
    this.connect()
  }

  private get initialReconnectDelay(): number {
    return this.props.reconnectDelay ?? DEFAULT_RECONNECT_DELAY
  }

  private connect(): void {
    const sinceQuery = this.state.lastOffset > 0 ? `&since=${this.state.lastOffset}` : ""
    const wsUrl = `${this.props.baseUrl}${sinceQuery}`
    const factory =
      this.props.webSocketFactory ?? ((url, protocols) => new WebSocket(url, protocols))
    const ws = factory(wsUrl, this.props.protocols ?? undefined)
    const scheduler =
      this.props.reconnectScheduler ?? ((cb, delay) => setTimeout(cb, delay))

    ws.addEventListener("open", () => {
      this.state.reconnectDelay = this.initialReconnectDelay
      process.stderr.write(`funnel: connected (${wsUrl})\n`)
    })

    ws.addEventListener("message", (event) => this.handleMessage(event))

    ws.addEventListener("close", () => {
      process.stderr.write(
        `funnel: disconnected, reconnecting in ${this.state.reconnectDelay}ms\n`,
      )
      scheduler(() => this.connect(), this.state.reconnectDelay)
      this.state.reconnectDelay = Math.min(this.state.reconnectDelay * 2, MAX_RECONNECT_DELAY)
    })

    ws.addEventListener("error", (event) => {
      const detail =
        event instanceof ErrorEvent && event.message
          ? event.message
          : "error event (close handler will reconnect)"

      process.stderr.write(`funnel: socket error: ${detail}\n`)
    })
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (typeof event.data !== "string") {
      process.stderr.write("funnel: ignoring non-string frame\n")
      return
    }

    let payload: { content?: unknown; meta?: Record<string, unknown>; offset?: unknown }

    try {
      payload = JSON.parse(event.data)
    } catch (error) {
      process.stderr.write(
        `funnel: skipping malformed frame: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      return
    }

    const offset = typeof payload.offset === "number" ? payload.offset : null
    const eventType =
      typeof payload.meta?.event_type === "string" ? payload.meta.event_type : "unknown"

    process.stderr.write(`funnel: received event (${eventType})\n`)

    const meta: Record<string, string> = {}

    for (const [key, value] of Object.entries(payload.meta ?? {})) {
      if (typeof value === "string") meta[key] = value
    }

    if (offset !== null) meta.offset = String(offset)

    try {
      await this.props.server.notification({
        method: "notifications/claude/channel",
        params: { content: payload.content, meta },
      })
    } catch (error) {
      process.stderr.write(
        `funnel: notification failed (offset=${offset ?? "?"}): ${error instanceof Error ? error.message : String(error)}\n`,
      )

      return
    }

    // Persist only after Claude has the event. If notification throws above,
    // the offset is not advanced, so reconnects re-deliver via `?since=`.
    if (offset !== null && offset > this.state.lastOffset) {
      this.state.lastOffset = offset
      this.persistOffset(offset)
    }
  }

  private persistOffset(offset: number): void {
    if (!this.props.offsetPort) return

    try {
      this.props.offsetPort.save(offset)
    } catch (error) {
      process.stderr.write(
        `funnel: failed to persist offset ${offset}: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  }
}
