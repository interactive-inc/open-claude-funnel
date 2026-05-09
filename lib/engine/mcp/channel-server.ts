import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { FUNNEL_MCP_NAME } from "@/engine/mcp/mcp"

const GATEWAY_WS_URL = process.env.FUNNEL_GATEWAY_URL ?? "ws://localhost:9742/ws"
const RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 10000

const readGatewayToken = (): string | null => {
  const fromEnv = process.env.FUNNEL_GATEWAY_TOKEN

  if (fromEnv && fromEnv.length > 0) return fromEnv

  const path = join(homedir(), ".funnel", "gateway.token")

  if (!existsSync(path)) return null

  const value = readFileSync(path, "utf-8").trim()

  return value.length > 0 ? value : null
}

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

  const token = readGatewayToken()
  const baseUrl = `${GATEWAY_WS_URL}?channel=${encodeURIComponent(channelId)}`
  const protocols = token ? [`funnel.token.${token}`] : undefined
  let reconnectDelay = RECONNECT_DELAY
  let lastOffset = 0

  const connect = () => {
    const sinceQuery = lastOffset > 0 ? `&since=${lastOffset}` : ""
    const wsUrl = `${baseUrl}${sinceQuery}`
    const ws = new WebSocket(wsUrl, protocols)

    ws.addEventListener("open", () => {
      reconnectDelay = RECONNECT_DELAY
      process.stderr.write(`funnel: connected (${wsUrl})\n`)
    })

    ws.addEventListener("message", async (event) => {
      try {
        const payload = JSON.parse(String(event.data))
        const eventType = payload.meta?.event_type ?? "unknown"

        if (typeof payload.offset === "number" && payload.offset > lastOffset) {
          lastOffset = payload.offset
        }

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
