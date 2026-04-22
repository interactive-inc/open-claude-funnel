import { WebClient } from "@slack/web-api"
import {
  FunnelConnectorAdapter,
  type CallInput,
} from "@/modules/connectors/funnel-connector-adapter"
import type { SlackConnectorConfig } from "@/modules/connectors/slack-connector-schema"

export type SlackWebClientLike = {
  apiCall: (method: string, options: Record<string, unknown>) => Promise<unknown>
}

type Deps = {
  config: SlackConnectorConfig
  client?: SlackWebClientLike
}

export class FunnelSlackAdapter extends FunnelConnectorAdapter {
  private readonly client: SlackWebClientLike

  constructor(deps: Deps) {
    super()
    this.client = deps.client ?? new WebClient(deps.config.botToken)
    Object.freeze(this)
  }

  async call(input: CallInput): Promise<unknown> {
    const body = input.body && typeof input.body === "object" ? input.body : {}

    return await this.client.apiCall(input.path, body as Record<string, unknown>)
  }
}
