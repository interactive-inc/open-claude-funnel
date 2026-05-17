import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { FUNNEL_MCP_NAME } from "@/engine/mcp/mcp"
import { settingsSchema } from "@/engine/settings/settings-schema"

const DEFAULT_FUNNEL_DIR = join(homedir(), ".funnel")
const DEFAULT_GATEWAY_BASE_URL = "http://localhost:9742"
const RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 10000
const TOOL_CONNECTOR_TYPES = new Set(["slack", "gh", "discord"])

export type ChannelServerOptions = {
  /** Funnel home directory (settings.json + gateway.token). Defaults to ~/.funnel. */
  dir?: string
  /** Gateway base URL. Defaults to `$FUNNEL_GATEWAY_URL` or `http://localhost:9742`. */
  gatewayUrl?: string
  /** Channel id to subscribe to. Defaults to `$FUNNEL_CHANNEL_ID`. */
  channelId?: string
  /** Auth token. Defaults to `$FUNNEL_GATEWAY_TOKEN` then `<dir>/gateway.token`. */
  token?: string
}

const readGatewayToken = (dir: string): string | null => {
  const fromEnv = process.env.FUNNEL_GATEWAY_TOKEN

  if (fromEnv && fromEnv.length > 0) return fromEnv

  const path = join(dir, "gateway.token")

  if (!existsSync(path)) return null

  const value = readFileSync(path, "utf-8").trim()

  return value.length > 0 ? value : null
}

const readChannelConnectors = (
  dir: string,
  channelId: string,
): { channelName: string; connectors: { name: string; type: string }[] } | null => {
  const settingsPath = join(dir, "settings.json")

  if (!existsSync(settingsPath)) return null

  const raw = JSON.parse(readFileSync(settingsPath, "utf-8"))
  const parsed = settingsSchema.safeParse(raw)

  if (!parsed.success) return null

  const channel = parsed.data.channels.find((c) => c.id === channelId)

  if (!channel) return null

  const connectors = channel.connectors
    .filter((c) => TOOL_CONNECTOR_TYPES.has(c.type))
    .map((c) => ({ name: c.name, type: c.type }))

  return { channelName: channel.name, connectors }
}

const usageHintForType = (type: string): string => {
  if (type === "slack") {
    return "Slack Web API. method=POST path=chat.postMessage body={channel,text,thread_ts?}"
  }

  if (type === "discord") {
    return "Discord REST API. method=POST path=/channels/<id>/messages body={content,...}"
  }

  if (type === "gh") {
    return "GitHub REST via gh CLI. method=POST path=repos/owner/repo/issues/N/comments body={body}"
  }

  return "Generic adapter call."
}

export const startChannelServer = async (
  options: ChannelServerOptions = {},
): Promise<void> => {
  const dir = options.dir ?? DEFAULT_FUNNEL_DIR
  const gatewayBaseUrl =
    options.gatewayUrl ?? process.env.FUNNEL_GATEWAY_URL ?? DEFAULT_GATEWAY_BASE_URL
  const gatewayWsUrl = `${gatewayBaseUrl.replace(/^http/, "ws")}/ws`
  const channelId = options.channelId ?? process.env.FUNNEL_CHANNEL_ID
  const channel = channelId ? readChannelConnectors(dir, channelId) : null
  const token = options.token ?? readGatewayToken(dir)

  const server = new Server(
    { name: FUNNEL_MCP_NAME, version: "1.0.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: [
        `Events arrive inside <channel source="${FUNNEL_MCP_NAME}"> tags. Use meta.event_type to discriminate.`,
        "",
        "To reply or act, call the connector tool exposed by this MCP (one tool per connector configured on this channel). Each tool takes { method, path, body } matching the underlying adapter's CallInput.",
      ].join("\n"),
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = (channel?.connectors ?? []).map((c) => ({
      name: c.name,
      description: `Call the "${c.name}" (${c.type}) connector. ${usageHintForType(c.type)}`,
      inputSchema: {
        type: "object" as const,
        properties: {
          method: { type: "string", description: "HTTP verb or API method (e.g. POST, chat.postMessage)" },
          path: { type: "string", description: "API path or method name (adapter-specific)" },
          body: { type: "object", description: "Request body / params (adapter-specific)" },
        },
        required: ["method", "path"],
      },
    }))

    return { tools }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!channel) {
      throw new Error("FUNNEL_CHANNEL_ID is not set or channel not found in settings.json")
    }

    const connectorName = request.params.name
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const method = typeof args.method === "string" ? args.method : ""
    const path = typeof args.path === "string" ? args.path : ""
    const body = args.body ?? {}

    if (!method || !path) {
      throw new Error("`method` and `path` are required")
    }

    const url = `${gatewayBaseUrl}/channels/${encodeURIComponent(channel.channelName)}/connectors/${encodeURIComponent(connectorName)}/call`
    const headers: Record<string, string> = { "content-type": "application/json" }

    if (token) headers.authorization = `Bearer ${token}`

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ method, path, body }),
    })

    const text = await res.text()

    if (!res.ok) {
      throw new Error(`gateway call failed (${res.status}): ${text}`)
    }

    return {
      content: [{ type: "text", text }],
    }
  })

  const transport = new StdioServerTransport()

  await server.connect(transport)

  if (!channelId) return

  const baseUrl = `${gatewayWsUrl}?channel=${encodeURIComponent(channelId)}`
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
