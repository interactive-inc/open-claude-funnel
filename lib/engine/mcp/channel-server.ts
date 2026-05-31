import { homedir } from "node:os"
import { join } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { FunnelChannelSubscriber } from "@/engine/mcp/channel-subscriber"
import { FUNNEL_MCP_NAME } from "@/engine/mcp/mcp"
import { readChannelConnectors } from "@/engine/mcp/read-channel-connectors"
import { readGatewayToken } from "@/engine/mcp/read-gateway-token"
import { usageHintForType } from "@/engine/mcp/usage-hint-for-type"
import { resolveFunnelPort } from "@/engine/settings/settings-store"

const DEFAULT_FUNNEL_DIR = join(homedir(), ".funnel")

export type ChannelServerOptions = {
  /** Funnel home directory (settings.json + gateway.token). Defaults to ~/.funnel. */
  dir?: string
  /** Gateway base URL. Defaults to `$FUNNEL_GATEWAY_URL` or `http://127.0.0.1:<port>`. */
  gatewayUrl?: string
  /** Channel id to subscribe to. Defaults to `$FUNNEL_CHANNEL_ID`. */
  channelId?: string
  /** Auth token. Defaults to `$FUNNEL_GATEWAY_TOKEN` then `<dir>/gateway.token`. */
  token?: string
}

export const startChannelServer = async (
  options: ChannelServerOptions = {},
): Promise<void> => {
  const dir = options.dir ?? DEFAULT_FUNNEL_DIR
  const gatewayBaseUrl =
    options.gatewayUrl ?? process.env.FUNNEL_GATEWAY_URL ?? `http://127.0.0.1:${resolveFunnelPort()}`
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

  const subscriber = new FunnelChannelSubscriber({
    server,
    baseUrl: `${gatewayWsUrl}?channel=${encodeURIComponent(channelId)}`,
    protocols: token ? [`funnel.token.${token}`] : undefined,
  })

  subscriber.start()
}
