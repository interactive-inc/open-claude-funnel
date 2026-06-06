/**
 * A JSON-serializable value. Connector call bodies are sent to external APIs as
 * JSON, so the body must be representable as JSON — `JsonValue` says exactly
 * that, replacing a bare `unknown` that let non-serializable values (functions,
 * symbols, class instances) slip through to `JSON.stringify`.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type CallInput = {
  method: string
  path: string
  /** JSON request body. Omit for GET-like calls. */
  body?: JsonValue
}

export abstract class FunnelConnectorAdapter {
  /**
   * Dispatches one Claude → external call. The response is the external API's
   * raw payload, typed `unknown` because its shape is the provider's concern —
   * the caller (Claude, via MCP) interprets it.
   */
  abstract call(input: CallInput): Promise<unknown>
}
