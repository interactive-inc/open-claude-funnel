import { usageHintForType } from "@/engine/mcp/usage-hint-for-type"

export const BUILTIN_TOOL_NAMES = [
  "fnl_doctor",
  "fnl_status",
  "fnl_debug",
  "fnl_recent_events",
  "fnl_dropped_events",
  "fnl_connection_errors",
  "fnl_replay_event",
  "fnl_docs",
] as const

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number]

export const isBuiltinTool = (name: string): name is BuiltinToolName =>
  (BUILTIN_TOOL_NAMES as readonly string[]).includes(name)

type ChannelSummary = { id: string; name: string }

type ConnectorSummary = { name: string; type: string }

type Tool = {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * Build the per-connector outbound tools. One tool per connector; the channel
 * MCP server exposes them so Claude can dispatch HTTP / API calls without
 * shelling out.
 */
export const buildConnectorTools = (connectors: ConnectorSummary[]): Tool[] =>
  connectors.map((connector) => ({
    name: connector.name,
    description: `Call the "${connector.name}" (${connector.type}) connector. ${usageHintForType(connector.type)}`,
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

/**
 * Build the built-in fnl_* tools that drive diagnosis, recovery, and docs.
 * The list mirrors BUILTIN_TOOL_NAMES; descriptions are tuned for Claude to
 * pick the right tool from the name + summary alone.
 */
export const buildBuiltinTools = (allChannels: ChannelSummary[]): Tool[] => {
  const channelEnum = allChannels.length > 0 ? allChannels.map((ch) => ch.name) : undefined

  const channelArgSchema = channelEnum
    ? {
        type: "string" as const,
        description: `Channel name to inspect. One of: ${channelEnum.join(", ")}. Omit to use the first available.`,
        enum: channelEnum,
      }
    : {
        type: "string" as const,
        description: "Channel name. Omit to use the first available.",
      }

  return [
    {
      name: "fnl_doctor",
      description:
        "Diagnose every channel and optionally apply safe self-healing fixes. Returns { status (ok|warn|error), message, appliedActions[], remainingIssues[], before, after }. When status is 'ok' you are done. Use this as the FIRST tool when anything seems off — it replaces the older diagnose → recover → verify loop with one call.",
      inputSchema: {
        type: "object" as const,
        properties: {
          mode: {
            type: "string",
            enum: ["off", "safe", "aggressive"],
            description:
              "off (default): read-only diagnosis. safe: also start gateway if down and restart dead listeners. aggressive: also restart the gateway when safe fixes are not enough.",
          },
        },
      },
    },
    {
      name: "fnl_status",
      description:
        "Return the gateway status as JSON — gateway running state, every listener's alive/dead per channel, and connected Claude WS clients. Lightweight snapshot; use fnl_doctor when you want diagnosis with next actions.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "fnl_debug",
      description:
        "Return a full channel diagnosis as JSON — gateway health, listeners, Claude WS connection, last 5 inbound events, connection errors (when listener is dead), and `diagnosis` with `status` (ok|warn|error), `message`, `nextActions`, and `rootCause`. Call this whenever events seem missing or to verify a fix worked. Omit `channel` to diagnose all channels.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel: {
            ...channelArgSchema,
            description: `${channelArgSchema.description} Omit to diagnose all channels.`,
          },
        },
      },
    },
    {
      name: "fnl_recent_events",
      description:
        "Return the last N processed events for a channel as JSON, with `outcome` (emitted | skip:type | skip:dedup | skip:subtype | skip:self-user | …), payload preview, and seq. Use this when you need to confirm whether a specific event reached the broadcaster.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel: channelArgSchema,
          limit: { type: "number", description: "Max rows (default 20)" },
        },
      },
    },
    {
      name: "fnl_dropped_events",
      description:
        "Return events that were filtered out (outcome starts with `skip:`) for a channel. Use when fnl_debug says listeners look healthy but a particular message never reached Claude — the skip reason tells you why.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel: channelArgSchema,
          limit: { type: "number", description: "Max rows (default 20)" },
        },
      },
    },
    {
      name: "fnl_connection_errors",
      description:
        "Return listener connection lifecycle errors (auth-failed / error). Use when a listener never connects or keeps disconnecting — the detail field carries the upstream error message.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel: channelArgSchema,
          limit: { type: "number", description: "Max rows (default 20)" },
        },
      },
    },
    {
      name: "fnl_replay_event",
      description:
        "Re-publish a past event back into a channel so subscribers receive it again. Call after applying a fix to verify Claude handles the previously-failed event correctly. Without `seq`, replays the most recent emitted event for that channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel: channelArgSchema,
          seq: { type: "number", description: "Processed-table seq to replay (optional)" },
        },
        required: ["channel"],
      },
    },
    {
      name: "fnl_docs",
      description:
        "Return embedded funnel documentation. Without `topic`, returns the list of topics. With `topic`, returns the full text. Topics: architecture, channels, connectors, profiles, claude, mcp, gateway, local-config, debugging, recipes, glossary.",
      inputSchema: {
        type: "object" as const,
        properties: {
          topic: {
            type: "string",
            description: "Topic name (omit to list available topics)",
          },
        },
      },
    },
  ]
}
