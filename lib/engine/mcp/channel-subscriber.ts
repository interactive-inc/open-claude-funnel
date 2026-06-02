import type { Server } from "@modelcontextprotocol/sdk/server/index.js"

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
}

/**
 * Subscribes to the gateway WebSocket for a single channel and forwards
 * incoming events to the MCP server as `notifications/claude/channel`.
 * Reconnects with exponential backoff and replays missed events via `?since=<offset>`.
 */
export class FunnelChannelSubscriber {
  private readonly state: State = { reconnectDelay: RECONNECT_DELAY, lastOffset: 0 }

  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

  start(): void {
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
      process.stderr.write(`funnel: disconnected, reconnecting in ${this.state.reconnectDelay}ms\n`)
      setTimeout(() => this.connect(), this.state.reconnectDelay)
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

      if (typeof payload.offset === "number" && payload.offset > this.state.lastOffset) {
        this.state.lastOffset = payload.offset
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
        `funnel: error: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  }
}
