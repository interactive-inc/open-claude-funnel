import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { renderYaml } from "@/engine/yaml/yaml-render"
import { handleBuiltinTool } from "@/engine/mcp/channel-server-builtin-handler"
import { buildChannelServerInstructions } from "@/engine/mcp/channel-server-instructions"
import {
  buildBuiltinTools,
  buildConnectorTools,
  isBuiltinTool,
} from "@/engine/mcp/channel-server-tools"
import { FunnelChannelSubscriber } from "@/engine/mcp/channel-subscriber"
import { FUNNEL_MCP_NAME } from "@/engine/mcp/mcp"
import { builtinConnectors } from "@/engine/connectors/builtin-connectors"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { readChannelConnectors } from "@/engine/mcp/read-channel-connectors"
import { readGatewayToken } from "@/engine/mcp/read-gateway-token"
import { settingsSchema } from "@/engine/settings/settings-schema"
import { resolveFunnelPort } from "@/engine/settings/settings-store"
import { gatewayLoopbackUrl } from "@/engine/http/gateway-base-url"

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
  /** Connector descriptors whose tools this MCP server exposes. Defaults to the
   *  four built-in connectors; the tool-exposed subset is derived from them. */
  connectors?: ConnectorDescriptor[]
}

const toolConnectorTypesOf = (descriptors: ConnectorDescriptor[]): Set<string> => {
  const out = new Set<string>()

  for (const descriptor of descriptors) {
    if (descriptor.toolExposed) out.add(descriptor.type)
  }

  return out
}

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

/**
 * Start the funnel MCP server over stdio. Wires:
 *
 *  - inbound channel subscription (gateway WebSocket → notifications/claude/channel)
 *  - outbound per-connector tools (one tool per connector, dispatched via gateway HTTP)
 *  - built-in fnl_* diagnostic + recovery tools (delegated to handleBuiltinTool)
 *
 * Tool definitions live in channel-server-tools.ts; the instructions string in
 * channel-server-instructions.ts; HTTP helpers in channel-server-http.ts. This
 * file is the orchestrator — wiring only, no business logic.
 */
export const startChannelServer = async (options: ChannelServerOptions = {}): Promise<void> => {
  const dir = options.dir ?? DEFAULT_FUNNEL_DIR
  const gatewayBaseUrl =
    options.gatewayUrl ?? process.env.FUNNEL_GATEWAY_URL ?? gatewayLoopbackUrl(resolveFunnelPort())
  const gatewayWsUrl = `${gatewayBaseUrl.replace(/^http/, "ws")}/ws`
  const channelId = options.channelId ?? process.env.FUNNEL_CHANNEL_ID
  const toolConnectorTypes = toolConnectorTypesOf(options.connectors ?? builtinConnectors())
  const channel = channelId ? readChannelConnectors(dir, channelId, toolConnectorTypes) : null
  const token = options.token ?? readGatewayToken(dir)
  const allChannels = readAllChannels(dir)
  const currentChannelName = channel?.channelName ?? null

  const server = new Server(
    { name: FUNNEL_MCP_NAME, version: "1.0.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: buildChannelServerInstructions(allChannels, currentChannelName),
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...buildConnectorTools(channel?.connectors ?? []), ...buildBuiltinTools(allChannels)],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name

    if (isBuiltinTool(toolName)) {
      return handleBuiltinTool({
        name: toolName,
        args: request.params.arguments,
        gatewayBaseUrl,
        token,
        allChannels,
      })
    }

    if (!channel) {
      throw new Error("FUNNEL_CHANNEL_ID is not set or channel not found in settings.json")
    }

    return await dispatchConnectorTool({
      channelName: channel.channelName,
      toolName,
      args: request.params.arguments ?? {},
      gatewayBaseUrl,
      token,
    })
  })

  const transport = new StdioServerTransport()

  await server.connect(transport)

  // Surface a startup hint so a Claude in any repo can self-discover the diagnostic loop.
  process.stderr.write(
    `funnel MCP ready (channel=${currentChannelName ?? "?"}); if events stop, call fnl_doctor.\n`,
  )

  if (!channelId) return

  const subscriber = new FunnelChannelSubscriber({
    server,
    baseUrl: `${gatewayWsUrl}?channel=${encodeURIComponent(channelId)}`,
    protocols: token ? [`funnel.token.${token}`] : undefined,
  })

  subscriber.start()
}

type ConnectorDispatchInput = {
  channelName: string
  toolName: string
  args: Record<string, unknown>
  gatewayBaseUrl: string
  token: string | null
}

const dispatchConnectorTool = async (
  input: ConnectorDispatchInput,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> => {
  const method = typeof input.args.method === "string" ? input.args.method : ""
  const path = typeof input.args.path === "string" ? input.args.path : ""
  // Leave body undefined when absent so the gateway / adapter applies its own
  // "no body" handling rather than receiving a spurious empty object.
  const body = input.args.body

  if (!method || !path) throw new Error("`method` and `path` are required")

  const url = `${input.gatewayBaseUrl}/channels/${encodeURIComponent(input.channelName)}/connectors/${encodeURIComponent(input.toolName)}/call`
  const headers: Record<string, string> = { "content-type": "application/json" }

  if (input.token) headers.authorization = `Bearer ${input.token}`

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, path, body }),
  })
  const text = await res.text()

  if (!res.ok) {
    return {
      content: [
        {
          type: "text",
          text: renderYaml({
            error: `gateway call failed (${res.status}): ${text}`,
            nextAction: "Call fnl_doctor to diagnose the failure",
          }),
        },
      ],
      isError: true,
    }
  }

  // Adapter responses (Slack / GitHub / Discord) are JSON. Re-render as YAML
  // so Claude sees the same surface as the diagnostic tools.
  try {
    const parsed = JSON.parse(text)

    return { content: [{ type: "text", text: renderYaml(parsed) }] }
  } catch {
    return { content: [{ type: "text", text }] }
  }
}
