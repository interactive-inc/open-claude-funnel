import { homedir } from "node:os"
import { join } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelChannelOffsetStore } from "@/engine/mcp/channel-offset-store"
import { FunnelChannelSubscriber } from "@/engine/mcp/channel-subscriber"
import { FUNNEL_MCP_NAME } from "@/engine/mcp/mcp"
import { readChannelConnectors } from "@/engine/mcp/read-channel-connectors"
import { readGatewayToken } from "@/engine/mcp/read-gateway-token"
import { usageHintForType } from "@/engine/mcp/usage-hint-for-type"

const DEFAULT_FUNNEL_DIR = join(homedir(), ".funnel")
const DEFAULT_GATEWAY_BASE_URL = "http://localhost:9742"
const FUNNEL_EVENTS_TOOL = "funnel_events"
const FUNNEL_EVENTS_DEFAULT_LIMIT = 20

export type ChannelServerOptions = {
  /** Funnel home directory (settings.json + gateway.token). Defaults to ~/.funnel. */
  dir?: string
  /** Gateway base URL. Defaults to `$FUNNEL_GATEWAY_URL` or `http://localhost:9742`. */
  gatewayUrl?: string
  /** Channel id to subscribe to. Defaults to `$FUNNEL_CHANNEL_ID`. */
  channelId?: string
  /** Auth token. Defaults to `$FUNNEL_GATEWAY_TOKEN` then `<dir>/gateway.token`. */
  token?: string
  /** Working directory used as the persistence key for last-offset. Defaults to `process.cwd()`. */
  cwd?: string
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
  const cwd = options.cwd ?? process.cwd()

  const server = new Server(
    { name: FUNNEL_MCP_NAME, version: "1.0.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: [
        `Events arrive inside <channel source="${FUNNEL_MCP_NAME}"> tags. Use meta.event_type to`,
        "discriminate and meta.offset (a numeric string) as the broadcaster sequence number.",
        "",
        "Push notifications are best-effort: the host may drop them while you are mid-turn, between turns,",
        `or across MCP restarts. Whenever you finish handling an event, call \`${FUNNEL_EVENTS_TOOL}\` once`,
        "to confirm you have not missed anything newer on the same channel. Pass the highest meta.offset",
        "you have already processed as `since`, look at the returned events, and respond to any unhandled",
        "ones the same way you would a pushed event. Repeat until the response is empty (cap at 3 passes).",
        "",
        "To reply or act on external services, call the per-connector tool exposed by this MCP (one tool",
        "per connector configured on this channel). Each tool takes { method, path, body } matching the",
        "underlying adapter's CallInput.",
      ].join("\n"),
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const connectorTools = (channel?.connectors ?? []).map((c) => ({
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

    if (!channel) return { tools: connectorTools }

    const funnelEventsTool = {
      name: FUNNEL_EVENTS_TOOL,
      description: [
        "Look up recent events on this channel from the funnel event store.",
        "Use this at the end of any event-handling turn to confirm push notifications did not drop anything.",
        "Events are returned in ascending offset order (oldest first). Loop until the response is empty;",
        "the channel-server instructions cap polling at 3 passes per turn.",
      ].join(" "),
      inputSchema: {
        type: "object" as const,
        properties: {
          since: {
            type: "number",
            description:
              "Broadcaster offset to start after (exclusive). Pass the highest offset you have already processed. Omit (or pass 0) to scan from the start of the retained window, oldest first.",
          },
          limit: {
            type: "number",
            description: `Maximum number of events to return. Defaults to ${FUNNEL_EVENTS_DEFAULT_LIMIT}.`,
          },
          connector: {
            type: "string",
            description: "Optional connector name to filter by (e.g. a slack connector name).",
          },
        },
      },
    }

    return { tools: [funnelEventsTool, ...connectorTools] }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!channel) {
      throw new Error("FUNNEL_CHANNEL_ID is not set or channel not found in settings.json")
    }

    if (request.params.name === FUNNEL_EVENTS_TOOL) {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      const since = typeof args.since === "number" ? args.since : null
      const limit = typeof args.limit === "number" ? args.limit : null
      const connector = typeof args.connector === "string" ? args.connector : null
      const query = new URLSearchParams()

      if (since !== null) query.set("since", String(since))
      if (limit !== null) query.set("limit", String(limit))
      if (connector !== null) query.set("connector", connector)

      const qs = query.toString()
      const url = `${gatewayBaseUrl}/channels/${encodeURIComponent(channel.channelName)}/events${qs ? `?${qs}` : ""}`
      const headers: Record<string, string> = { accept: "application/json" }

      if (token) headers.authorization = `Bearer ${token}`

      let res: Response

      try {
        res = await fetch(url, { headers })
      } catch (error) {
        throw new Error(
          `funnel_events: gateway unreachable at ${url}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      const text = await res.text()

      if (!res.ok) {
        throw new Error(`funnel_events: gateway responded ${res.status}: ${text}`)
      }

      return { content: [{ type: "text", text }] }
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

    let res: Response

    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ method, path, body }),
      })
    } catch (error) {
      throw new Error(
        `connector call: gateway unreachable at ${url}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const text = await res.text()

    if (!res.ok) {
      throw new Error(`connector call: gateway responded ${res.status}: ${text}`)
    }

    return {
      content: [{ type: "text", text }],
    }
  })

  const transport = new StdioServerTransport()

  await server.connect(transport)

  if (!channelId) return

  const offsetStore = new FunnelChannelOffsetStore({
    fs: new NodeFunnelFileSystem(),
    dir,
  })
  const offsetPort = {
    load: () => offsetStore.get(channelId, cwd),
    save: (offset: number) => offsetStore.set(channelId, cwd, offset),
  }
  const subscriber = new FunnelChannelSubscriber({
    server,
    baseUrl: `${gatewayWsUrl}?channel=${encodeURIComponent(channelId)}`,
    protocols: token ? [`funnel.token.${token}`] : null,
    offsetPort,
  })

  subscriber.start()
}
