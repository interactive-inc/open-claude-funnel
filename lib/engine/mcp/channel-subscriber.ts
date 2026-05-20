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
  protocols: string[] | undefined
  /**
   * Persistence for the broadcaster offset. The MCP child re-spawns on every
   * Claude Code restart and would otherwise reset `lastOffset` to 0, missing
   * events that arrived between the daemon broadcasting them and the new
   * socket opening. With a port wired in, restarts ask the gateway for
   * `?since=<offset>` and the SQLite event store backfills the gap.
   */
  offsetPort?: ChannelOffsetPort | null
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
  private readonly offsetPort: ChannelOffsetPort | null
  private readonly webSocketFactory: WebSocketFactory
  private readonly initialReconnectDelay: number
  private readonly reconnectScheduler: ReconnectScheduler

  constructor(private readonly props: Props) {
    this.offsetPort = props.offsetPort ?? null
    this.webSocketFactory =
      props.webSocketFactory ?? ((url, protocols) => new WebSocket(url, protocols))
    this.initialReconnectDelay = props.reconnectDelay ?? DEFAULT_RECONNECT_DELAY
    this.reconnectScheduler =
      props.reconnectScheduler ?? ((cb, delay) => setTimeout(cb, delay))
    this.state = {
      reconnectDelay: this.initialReconnectDelay,
      lastOffset: this.offsetPort?.load() ?? 0,
    }
    Object.freeze(this)
  }

  start(): void {
    this.connect()
  }

  private connect(): void {
    const sinceQuery = this.state.lastOffset > 0 ? `&since=${this.state.lastOffset}` : ""
    const wsUrl = `${this.props.baseUrl}${sinceQuery}`
    const ws = this.webSocketFactory(wsUrl, this.props.protocols)

    ws.addEventListener("open", () => {
      this.state.reconnectDelay = this.initialReconnectDelay
      process.stderr.write(`funnel: connected (${wsUrl})\n`)
    })

    ws.addEventListener("message", (event) => this.handleMessage(event))

    ws.addEventListener("close", () => {
      process.stderr.write(
        `funnel: disconnected, reconnecting in ${this.state.reconnectDelay}ms\n`,
      )
      this.reconnectScheduler(() => this.connect(), this.state.reconnectDelay)
      this.state.reconnectDelay = Math.min(this.state.reconnectDelay * 2, MAX_RECONNECT_DELAY)
    })

    ws.addEventListener("error", () => {
      // close handler will reconnect
    })
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    try {
      const payload = JSON.parse(String(event.data))
      const eventType = payload.meta?.event_type ?? "unknown"
      const offset = typeof payload.offset === "number" ? payload.offset : null

      if (offset !== null && offset > this.state.lastOffset) {
        this.state.lastOffset = offset
        this.offsetPort?.save(offset)
      }

      process.stderr.write(`funnel: received event (${eventType})\n`)

      const meta = {
        ...(payload.meta ?? {}),
        ...(offset !== null ? { offset: String(offset) } : {}),
      }

      await this.props.server.notification({
        method: "notifications/claude/channel",
        params: {
          content: payload.content,
          meta,
        },
      })
    } catch (error) {
      process.stderr.write(
        `funnel: error: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  }
}
