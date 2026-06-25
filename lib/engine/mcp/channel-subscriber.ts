import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { errorMessageOf } from "@/engine/error/error-message-of"

const RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 10000

type Props = {
  server: Server
  baseUrl: string
  protocols: string[] | undefined
}

type State = {
  reconnectDelay: number
  lastOffset: number
  isStarted: boolean
  hasPendingReconnect: boolean
}

/**
 * Subscribes to the gateway WebSocket for a single channel and forwards
 * incoming events to the MCP server as `notifications/claude/channel`.
 * Reconnects with exponential backoff and replays missed events via `?since=<offset>`.
 */
export class FunnelChannelSubscriber {
  private readonly state: State = {
    reconnectDelay: RECONNECT_DELAY,
    lastOffset: 0,
    isStarted: false,
    hasPendingReconnect: false,
  }

  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

  start(): void {
    if (this.state.isStarted) return

    this.state.isStarted = true
    this.connect()
  }

  private connect(): void {
    const sinceQuery = this.state.lastOffset > 0 ? `&since=${this.state.lastOffset}` : ""
    const wsUrl = `${this.props.baseUrl}${sinceQuery}`
    const ws = new WebSocket(wsUrl, this.props.protocols)

    ws.addEventListener("open", () => {
      this.state.reconnectDelay = RECONNECT_DELAY
      process.stderr.write(`funnel: connected (${wsUrl})\n`)
    })

    ws.addEventListener("message", (event) => this.handleMessage(event))

    ws.addEventListener("close", () => {
      // A socket emits close once, but a stray double-start or an error+close
      // pair must never stack reconnect loops — one pending attempt at a time.
      if (this.state.hasPendingReconnect) return

      this.state.hasPendingReconnect = true
      process.stderr.write(`funnel: disconnected, reconnecting in ${this.state.reconnectDelay}ms\n`)
      setTimeout(() => {
        this.state.hasPendingReconnect = false
        this.connect()
      }, this.state.reconnectDelay)
      this.state.reconnectDelay = Math.min(this.state.reconnectDelay * 2, MAX_RECONNECT_DELAY)
    })

    ws.addEventListener("error", (event) => {
      // Surface the reason the socket dropped so the operator can see what is
      // driving the reconnect loop (auth refused, server gone, network blip).
      // close handler still owns the actual reconnect.
      const reason = readErrorEventMessage(event)
      process.stderr.write(`funnel: ws error: ${reason}\n`)
    })
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    try {
      const payload = JSON.parse(String(event.data))
      const eventType = payload.meta?.event_type ?? "unknown"
      const offset =
        typeof payload.offset === "number" ? payload.offset : null

      if (offset !== null && offset > this.state.lastOffset) {
        this.state.lastOffset = offset
      }

      process.stderr.write(`funnel: received event (${eventType})\n`)

      await this.props.server.notification({
        method: "notifications/claude/channel",
        params: {
          content: payload.content,
          meta: payload.meta,
        },
      })
    } catch (error) {
      process.stderr.write(
        `funnel: error handling ws message (offset=${this.state.lastOffset}): ${errorMessageOf(error)}\n`,
      )
    }
  }
}

const readErrorEventMessage = (event: Event): string => {
  if (event instanceof Error) return event.message

  if ("message" in event && typeof event.message === "string") return event.message

  if ("error" in event && event.error instanceof Error) return event.error.message

  return "unknown"
}
