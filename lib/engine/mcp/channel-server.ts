import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { gatewayLoopbackUrl } from "@/gateway/gateway-base-url"
import { FunnelChannelSubscriber } from "@/engine/mcp/channel-subscriber"
import { FUNNEL_MCP_NAME } from "@/engine/mcp/mcp"
import { readChannelConnectors } from "@/engine/mcp/read-channel-connectors"
import { readGatewayToken } from "@/engine/mcp/read-gateway-token"
import { usageHintForType } from "@/engine/mcp/usage-hint-for-type"
import { settingsSchema } from "@/engine/settings/settings-schema"
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

const BUILTIN_TOOL_NAMES = ["fnl_status", "fnl_debug"] as const

type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number]

const isBuiltinTool = (name: string): name is BuiltinToolName =>
  (BUILTIN_TOOL_NAMES as readonly string[]).includes(name)

type ChannelSummary = { id: string; name: string }

const readAllChannels = (dir: string): ChannelSummary[] => {
  const settingsPath = join(dir, "settings.json")

  if (!existsSync(settingsPath)) return []

  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"))
    const parsed = settingsSchema.safeParse(raw)

    if (!parsed.success) return []

    return parsed.data.channels.map((c) => ({ id: c.id, name: c.name }))
  } catch {
    return []
  }
}

export const startChannelServer = async (options: ChannelServerOptions = {}): Promise<void> => {
  const dir = options.dir ?? DEFAULT_FUNNEL_DIR
  const gatewayBaseUrl =
    options.gatewayUrl ?? process.env.FUNNEL_GATEWAY_URL ?? gatewayLoopbackUrl(resolveFunnelPort())
  const gatewayWsUrl = `${gatewayBaseUrl.replace(/^http/, "ws")}/ws`
  const channelId = options.channelId ?? process.env.FUNNEL_CHANNEL_ID
  const channel = channelId ? readChannelConnectors(dir, channelId) : null
  const token = options.token ?? readGatewayToken(dir)
  const allChannels = readAllChannels(dir)
  const currentChannelName = channel?.channelName ?? null

  const channelContext =
    allChannels.length > 0
      ? [
          "",
          "Configured channels (use as the `channel` argument to fnl_debug):",
          ...allChannels.map(
            (ch) => `  ${ch.name}${ch.name === currentChannelName ? " ← this session" : ""}`,
          ),
        ].join("\n")
      : ""

  const server = new Server(
    { name: FUNNEL_MCP_NAME, version: "1.0.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: [
        `Events arrive as notifications (method: notifications/claude/channel) with two fields:`,
        `  content — the event payload as a JSON string (parse it to read the message)`,
        `  meta    — key/value strings describing the event`,
        "",
        "meta fields by event_type:",
        "  slack:    event_type=slack  channel_id=C…  thread_ts=1234.5678  user_id=U…  mentioned=true|false",
        "  gh:       event_type=gh     repository=owner/repo  subject_type=Issue|PullRequest  subject_url=…  reason=…",
        "  discord:  event_type=discord  channel_id=…  user_id=…  guild_id=…  mentioned=true|false",
        "  schedule: event_type=schedule  entry_id=…",
        "",
        "To reply to a Slack message in the same thread, call the connector tool with:",
        `  method: POST`,
        `  path:   chat.postMessage`,
        `  body:   { channel: meta.channel_id, text: "your reply", thread_ts: meta.thread_ts }`,
        "",
        "To comment on a GitHub issue/PR (extract from subject_url in meta):",
        `  method: POST`,
        `  path:   repos/<meta.repository>/issues/<number>/comments   (parse number from meta.subject_url)`,
        `  body:   { body: "your reply" }`,
        "",
        "Built-in diagnostic tools — call proactively when events seem missing or delayed:",
        "  fnl_status — gateway running state, all listeners alive/dead, Claude WS clients",
        "  fnl_debug  — per-channel diagnosis with last 10 events, rootCause, suggestedActions",
        "               omit channel arg to diagnose all channels; check summary.suggestedActions first",
        channelContext,
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
          method: {
            type: "string",
            description: "HTTP verb or API method (e.g. POST, chat.postMessage)",
          },
          path: { type: "string", description: "API path or method name (adapter-specific)" },
          body: { type: "object", description: "Request body / params (adapter-specific)" },
        },
        required: ["method", "path"],
      },
    }))

    const channelEnum = allChannels.length > 0 ? allChannels.map((ch) => ch.name) : undefined

    const builtinTools = [
      {
        name: "fnl_status",
        description:
          "Return the current funnel gateway status as JSON — gateway running state, listener alive/dead per channel, and connected Claude WS clients. Call this when you need to check whether the gateway is up or why events stopped arriving.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "fnl_debug",
        description:
          "Return a full channel diagnosis as JSON — gateway health, listener state, Claude WS connection, last 10 inbound events with outcome, connectionErrors (when listener is dead), and diagnosis.rootCause. Call this first when debugging missing events. Omit `channel` to diagnose all channels at once.",
        inputSchema: {
          type: "object" as const,
          properties: {
            channel: channelEnum
              ? {
                  type: "string",
                  description: `Channel name to inspect. One of: ${channelEnum.join(", ")}. Omit to get all channels.`,
                  enum: channelEnum,
                }
              : {
                  type: "string",
                  description: "Channel name to inspect. Omit to get all channels.",
                },
          },
        },
      },
    ]

    return { tools: [...connectorTools, ...builtinTools] }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name

    if (isBuiltinTool(toolName)) {
      return handleBuiltinTool(
        toolName,
        request.params.arguments,
        gatewayBaseUrl,
        token,
        allChannels,
      )
    }

    if (!channel) {
      throw new Error("FUNNEL_CHANNEL_ID is not set or channel not found in settings.json")
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const method = typeof args.method === "string" ? args.method : ""
    const path = typeof args.path === "string" ? args.path : ""
    // Leave body undefined when absent so the gateway / adapter applies its own
    // "no body" handling rather than receiving a spurious empty object.
    const body = args.body

    if (!method || !path) {
      throw new Error("`method` and `path` are required")
    }

    const url = `${gatewayBaseUrl}/channels/${encodeURIComponent(channel.channelName)}/connectors/${encodeURIComponent(toolName)}/call`
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

const handleBuiltinTool = async (
  name: BuiltinToolName,
  args: Record<string, unknown> | null | undefined,
  gatewayBaseUrl: string,
  token: string | null,
  allChannels: ChannelSummary[],
): Promise<{ content: { type: "text"; text: string }[] }> => {
  const headers: Record<string, string> = {}

  if (token) headers.authorization = `Bearer ${token}`

  if (name === "fnl_status") {
    const res = await fetch(`${gatewayBaseUrl}/status`, { headers }).catch(() => null)

    if (!res) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              running: false,
              error: "gateway unreachable",
              hint: "run: fnl gateway start",
              knownChannels: allChannels.map((ch) => ch.name),
            }),
          },
        ],
      }
    }

    const body = await res.json()

    return { content: [{ type: "text", text: JSON.stringify(body) }] }
  }

  const channelArg = typeof args?.channel === "string" ? args.channel : null
  const url = channelArg
    ? `${gatewayBaseUrl}/debug?channel=${encodeURIComponent(channelArg)}`
    : `${gatewayBaseUrl}/debug`

  const res = await fetch(url, { headers }).catch(() => null)

  if (!res) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            gateway: { running: false },
            channels: allChannels.map((ch) => ({
              id: ch.id,
              name: ch.name,
              diagnosis: {
                status: "error",
                message: "gateway is not running",
                nextAction: "fnl gateway start",
                rootCause: null,
              },
            })),
          }),
        },
      ],
    }
  }

  const body = await res.json()

  return { content: [{ type: "text", text: JSON.stringify(body) }] }
}
