import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { randomUUID } from "node:crypto"
import { errorMessageOf } from "@/engine/error/error-message-of"

const RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 10000

type Props = {
  server: Server
  baseUrl: string
  protocols: string[] | undefined
  createSocket?: (
    url: string,
    protocols?: string[],
  ) => Pick<WebSocket, "addEventListener" | "close">
  scheduleReconnect?: (connect: () => void, delay: number) => void
}

type State = {
  reconnectDelay: number
  lastOffset: number
  isStarted: boolean
  hasPendingReconnect: boolean
  hasDeliveryFailure: boolean
  firstOffset: number | null
  hasAttemptedConnection: boolean
  messageQueue: Promise<void>
}

type ClosableSocket = {
  close(): void
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
    hasDeliveryFailure: false,
    firstOffset: null,
    hasAttemptedConnection: false,
    messageQueue: Promise.resolve(),
  }
  private readonly subscriberId: string

  constructor(private readonly props: Props) {
    this.subscriberId = new URL(props.baseUrl).searchParams.get("id") || randomUUID()
    Object.freeze(this)
  }

  start(): void {
    if (this.state.isStarted) return

    this.state.isStarted = true
    this.connect()
  }

  private connect(): void {
    const url = new URL(this.props.baseUrl)
    url.searchParams.set("id", this.subscriberId)

    if (this.state.hasAttemptedConnection) {
      const since = this.state.lastOffset || Math.max(0, (this.state.firstOffset ?? 1) - 1)
      url.searchParams.set("since", String(since))
    }

    this.state.hasAttemptedConnection = true
    const wsUrl = url.toString()
    const createSocket =
      this.props.createSocket ?? ((address, protocols) => new WebSocket(address, protocols))
    const ws = createSocket(wsUrl, this.props.protocols)

    ws.addEventListener("open", () => {
      this.state.reconnectDelay = RECONNECT_DELAY
      process.stderr.write(`funnel: connected (${wsUrl})\n`)
    })

    ws.addEventListener("message", (event) => this.enqueueMessage(event, ws))

    ws.addEventListener("close", () => {
      // A socket emits close once, but a stray double-start or an error+close
      // pair must never stack reconnect loops — one pending attempt at a time.
      if (this.state.hasPendingReconnect) return

      this.state.hasPendingReconnect = true
      process.stderr.write(`funnel: disconnected, reconnecting in ${this.state.reconnectDelay}ms\n`)
      const schedule = this.props.scheduleReconnect ?? setTimeout
      schedule(() => {
        this.state.messageQueue.then(() => {
          this.state.hasPendingReconnect = false
          this.state.hasDeliveryFailure = false
          this.connect()
        })
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

  private enqueueMessage(event: MessageEvent, socket?: ClosableSocket): void {
    this.state.messageQueue = this.state.messageQueue.then(async () => {
      if (this.state.hasDeliveryFailure) return

      const delivered = await this.handleMessage(event)

      if (delivered) return

      // Do not acknowledge a later event past this gap. Closing the socket
      // causes the gateway to replay from the last successfully delivered
      // offset after reconnect.
      this.state.hasDeliveryFailure = true
      socket?.close()
    })
  }

  private async handleMessage(event: MessageEvent): Promise<boolean> {
    try {
      const payload = JSON.parse(String(event.data))
      const eventType = payload.meta?.event_type ?? "unknown"
      const offset = typeof payload.offset === "number" ? payload.offset : null

      if (this.state.firstOffset === null && offset !== null) this.state.firstOffset = offset

      process.stderr.write(`funnel: received event (${eventType})\n`)

      await this.props.server.notification({
        method: "notifications/claude/channel",
        params: {
          content: payload.content,
          meta: payload.meta,
        },
      })

      if (offset !== null && offset > this.state.lastOffset) {
        this.state.lastOffset = offset
      }

      return true
    } catch (error) {
      process.stderr.write(
        `funnel: error handling ws message (offset=${this.state.lastOffset}): ${errorMessageOf(error)}\n`,
      )

      return false
    }
  }
}

const readErrorEventMessage = (event: Event): string => {
  if (event instanceof Error) return event.message

  if ("message" in event && typeof event.message === "string") return event.message

  if ("error" in event && event.error instanceof Error) return event.error.message

  return "unknown"
}
