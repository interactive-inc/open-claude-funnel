import { renderYaml } from "@/engine/yaml/yaml-render"
import { loopbackFetch } from "@/engine/http/loopback-fetch"

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean }

const GATEWAY_OFFLINE_HINT = "Run `fnl gateway start` in a shell (MCP cannot start the daemon)"

/**
 * Pass a value through `renderYaml` into the shape the MCP transport expects.
 * Used for offline fallbacks where we synthesise a response locally instead
 * of forwarding gateway JSON.
 */
export const yamlResult = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: renderYaml(value) }],
})

/**
 * MCP error result with `isError: true` and a structured `{ error, nextAction }`
 * body. Keeping the shape uniform lets Claude pattern-match on `nextAction`
 * without re-parsing free-form text.
 */
export const errorResult = (message: string, nextAction: string | null): ToolResult => ({
  content: [
    {
      type: "text",
      text: renderYaml({ error: message, nextAction }),
    },
  ],
  isError: true,
})

/**
 * Convert a gateway HTTP response (JSON wire format) into the YAML text the
 * MCP transport hands back to Claude. YAML is what every fnl_* tool returns,
 * matching the CLI's output and keeping the parsing surface Claude has to
 * learn down to one.
 */
const toYamlResult = async (res: Response): Promise<ToolResult> => {
  const text = await res.text()

  try {
    const parsed = JSON.parse(text)

    return { content: [{ type: "text", text: renderYaml(parsed) }] }
  } catch {
    // Gateway returned something that wasn't valid JSON — pass it through
    // verbatim rather than swallow the body.
    return { content: [{ type: "text", text }] }
  }
}

export const getJson = async (
  url: string,
  headers: Record<string, string>,
  options: { offlineFallback?: unknown } = {},
): Promise<ToolResult> => {
  let res: Response | null = null
  try {
    res = await loopbackFetch(url, { headers })
  } catch {
    res = null
  }

  if (!res) {
    if (options.offlineFallback !== undefined) return yamlResult(options.offlineFallback)

    return errorResult("gateway unreachable", GATEWAY_OFFLINE_HINT)
  }

  return toYamlResult(res)
}

export const postJson = async (
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  options: { offlineFallback?: unknown } = {},
): Promise<ToolResult> => {
  // Doctor / replay can take a while (gateway restart, listener boot) — give
  // 30s for write-side MCP tools where the read-side 5s default would race.
  let res: Response | null = null
  try {
    res = await loopbackFetch(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      30_000,
    )
  } catch {
    res = null
  }

  if (!res) {
    if (options.offlineFallback !== undefined) return yamlResult(options.offlineFallback)

    return errorResult("gateway unreachable", GATEWAY_OFFLINE_HINT)
  }

  return toYamlResult(res)
}
