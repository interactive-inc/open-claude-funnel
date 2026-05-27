import { WebClient } from "@slack/web-api"
import { FunnelConnectorAdapter, type CallInput } from "@/connectors/connector-adapter"
import { resolveConnectorToken } from "@/connectors/resolve-connector-token"
import type { SlackConnectorConfig } from "@/connectors/slack-connector-schema"

export type SlackWebClientLike = {
  apiCall: (method: string, options?: Record<string, unknown>) => Promise<unknown>
}

const toRecord = (value: object): Record<string, unknown> => {
  const result: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(value)) result[key] = val

  return result
}

/**
 * Recognises errors that @slack/web-api throws for Slack-side API failures
 * (e.g. `cant_delete_message`, `channel_not_found`, rate limits). Every such
 * error carries `code: "slack_webapi_*"` and a `data` field holding the raw
 * Slack response with `ok: false`. We unwrap to that response so the caller
 * receives a structured failure instead of having the gateway translate it
 * into an opaque HTTP 500.
 */
const slackErrorResponse = (error: unknown): Record<string, unknown> | null => {
  if (!error || typeof error !== "object") return null
  if (!("code" in error)) return null

  const code = (error as { code: unknown }).code

  if (typeof code !== "string" || !code.startsWith("slack_webapi_")) return null
  if (!("data" in error)) return null

  const data = (error as { data: unknown }).data

  if (!data || typeof data !== "object") return null

  return data as Record<string, unknown>
}

type Deps = {
  config: SlackConnectorConfig
  /** Environment used to resolve a `botTokenEnv` reference. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
  client?: SlackWebClientLike
}

export class FunnelSlackAdapter extends FunnelConnectorAdapter {
  private readonly client: SlackWebClientLike

  constructor(deps: Deps) {
    super()
    const botToken = resolveConnectorToken({
      literal: deps.config.botToken,
      envVar: deps.config.botTokenEnv,
      env: deps.env ?? process.env,
      label: `${deps.config.name}.botToken`,
    })

    this.client = deps.client ?? new WebClient(botToken)
    Object.freeze(this)
  }

  async call(input: CallInput): Promise<unknown> {
    const body = input.body !== null && typeof input.body === "object" ? toRecord(input.body) : {}

    try {
      return await this.client.apiCall(input.path, body)
    } catch (error) {
      const slackResponse = slackErrorResponse(error)

      if (slackResponse) return slackResponse

      throw error
    }
  }
}
