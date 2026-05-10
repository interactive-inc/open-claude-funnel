import { FunnelConnectorAdapter, type CallInput } from "@/connectors/connector-adapter"
import type { SlackConnectorConfig } from "@/connectors/slack-connector-schema"

export type SlackWebClientLike = {
  apiCall: (method: string, options?: Record<string, unknown>) => Promise<unknown>
}

const toRecord = (value: object): Record<string, unknown> => {
  const result: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(value)) result[key] = val

  return result
}

type Deps = {
  config: SlackConnectorConfig
  client?: SlackWebClientLike
}

export class FunnelSlackAdapter extends FunnelConnectorAdapter {
  private readonly config: SlackConnectorConfig
  private readonly injectedClient: SlackWebClientLike | null
  private cachedClient: SlackWebClientLike | null = null

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.injectedClient = deps.client ?? null
  }

  private async getClient(): Promise<SlackWebClientLike> {
    if (this.injectedClient) return this.injectedClient
    if (this.cachedClient) return this.cachedClient

    const { WebClient } = await import("@slack/web-api")
    this.cachedClient = new WebClient(this.config.botToken)

    return this.cachedClient
  }

  async call(input: CallInput): Promise<unknown> {
    const body = input.body !== null && typeof input.body === "object" ? toRecord(input.body) : {}
    const client = await this.getClient()

    return await client.apiCall(input.path, body)
  }
}
