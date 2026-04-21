import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { FUNNEL_MCP_NAME } from "@/modules/mcp/funnel-mcp"

const GATEWAY_WS_URL = process.env.FUNNEL_GATEWAY_URL ?? "ws://localhost:9742/ws"
const RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 10000

export const startChannelServer = async (): Promise<void> => {
  const server = new Server(
    { name: FUNNEL_MCP_NAME, version: "1.0.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
      },
      instructions: [
        `Events arrive inside <channel source="${FUNNEL_MCP_NAME}"> tags. Use meta.event_type to discriminate.`,
        "",
        "To reply or act on an event, run `funnel request <platform> --help` via the Bash tool (e.g. `funnel request slack --help`). For general CLI usage, run `funnel --help`.",
      ].join("\n"),
    },
  )

  const transport = new StdioServerTransport()

  await server.connect(transport)

  const channelId = process.env.FUNNEL_CHANNEL_ID

  if (!channelId) return

  const wsUrl = `${GATEWAY_WS_URL}?channel=${encodeURIComponent(channelId)}`
  let reconnectDelay = RECONNECT_DELAY

  const connect = () => {
    const ws = new WebSocket(wsUrl)

    ws.addEventListener("open", () => {
      reconnectDelay = RECONNECT_DELAY
      process.stderr.write(`funnel: connected (${wsUrl})\n`)
    })

    ws.addEventListener("message", async (event) => {
      try {
        const payload = JSON.parse(String(event.data))
        const eventType = payload.meta?.event_type ?? "unknown"

        process.stderr.write(`funnel: received event (${eventType})\n`)

        await server.notification({
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
    })

    ws.addEventListener("close", () => {
      process.stderr.write(`funnel: disconnected, reconnecting in ${reconnectDelay}ms\n`)
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
    })

    ws.addEventListener("error", () => {
      // close handler will reconnect
    })
  }

  connect()
}
