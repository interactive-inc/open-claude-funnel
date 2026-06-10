import {
  errorResult,
  getJson,
  postJson,
  yamlResult,
  type ToolResult,
} from "@/engine/mcp/channel-server-http"
import type { BuiltinToolName } from "@/engine/mcp/channel-server-tools"
import { FunnelDocs } from "@/engine/docs/funnel-docs"

type ChannelSummary = { id: string; name: string }

type Deps = {
  name: BuiltinToolName
  args: Record<string, unknown> | null | undefined
  gatewayBaseUrl: string
  token: string | null
  allChannels: ChannelSummary[]
}

const docs = new FunnelDocs()

/**
 * Dispatch a built-in fnl_* tool call to the right gateway endpoint (over
 * loopback HTTP) and return the response as a YAML-text MCP result. The few
 * read-only tools that can run without the gateway (docs lookup) bypass HTTP
 * entirely.
 */
export const handleBuiltinTool = async (deps: Deps): Promise<ToolResult> => {
  const headers: Record<string, string> = {}

  if (deps.token) headers.authorization = `Bearer ${deps.token}`

  const args = deps.args
  const channelArg = typeof args?.channel === "string" ? args.channel : null
  const limitArg = typeof args?.limit === "number" ? args.limit : undefined
  const seqArg = typeof args?.seq === "number" ? args.seq : undefined
  const modeArg =
    args?.mode === "safe" || args?.mode === "aggressive" || args?.mode === "off" ? args.mode : "off"
  const topicArg = typeof args?.topic === "string" ? args.topic : null
  const base = deps.gatewayBaseUrl

  if (deps.name === "fnl_doctor") {
    return postJson(
      `${base}/doctor`,
      headers,
      { mode: modeArg },
      { offlineFallback: doctorOfflineFallback(deps.allChannels) },
    )
  }

  if (deps.name === "fnl_status") {
    return getJson(`${base}/status`, headers, {
      offlineFallback: {
        running: false,
        error: "gateway unreachable",
        nextAction: "run `fnl gateway start` in a shell (cannot be started from MCP)",
        knownChannels: deps.allChannels.map((ch) => ch.name),
      },
    })
  }

  if (deps.name === "fnl_debug") {
    const url = channelArg
      ? `${base}/diagnostics?channel=${encodeURIComponent(channelArg)}`
      : `${base}/diagnostics?all=true`

    return getJson(url, headers, {
      offlineFallback: {
        gateway: { running: false },
        diagnosis: {
          status: "error",
          message: "gateway is not running",
          nextActions: ["fnl gateway start"],
          rootCause: null,
        },
        knownChannels: deps.allChannels.map((ch) => ch.name),
      },
    })
  }

  if (deps.name === "fnl_recent_events") {
    return getJson(`${base}/diagnostics/events?${eventListQuery(channelArg, limitArg)}`, headers)
  }

  if (deps.name === "fnl_dropped_events") {
    return getJson(`${base}/diagnostics/dropped?${eventListQuery(channelArg, limitArg)}`, headers)
  }

  if (deps.name === "fnl_connection_errors") {
    return getJson(`${base}/diagnostics/errors?${eventListQuery(channelArg, limitArg)}`, headers)
  }

  if (deps.name === "fnl_replay_event") {
    if (!channelArg) {
      return errorResult("channel is required", "Provide the channel name (see fnl_status)")
    }

    return postJson(`${base}/diagnostics/replay`, headers, { channel: channelArg, seq: seqArg })
  }

  if (deps.name === "fnl_docs") {
    // Docs are bundled into the MCP server itself; no gateway hop needed.
    if (!topicArg) return yamlResult({ topics: docs.list() })

    const text = docs.get(topicArg)

    if (text === null) {
      return yamlResult({ error: `unknown topic: ${topicArg}`, availableTopics: docs.topics() })
    }

    return yamlResult({ topic: topicArg, text })
  }

  return errorResult(`unknown built-in tool: ${deps.name}`, null)
}

const eventListQuery = (channel: string | null, limit: number | undefined): string => {
  const params = new URLSearchParams()

  if (channel) params.set("channel", channel)
  if (limit !== undefined) params.set("limit", String(limit))

  return params.toString()
}

const doctorOfflineFallback = (allChannels: ChannelSummary[]) => ({
  status: "error",
  message:
    "gateway is not running and cannot be started over HTTP from the MCP side. Run `fnl gateway start` in a shell, or relaunch Claude with `fnl claude` which auto-starts the gateway.",
  appliedActions: [],
  remainingIssues: allChannels.map((ch) => ({
    channel: ch.name,
    diagnosis: {
      status: "error",
      message: "gateway is not running",
      nextActions: ["fnl gateway start"],
      rootCause: null,
    },
  })),
  before: null,
  after: null,
})
