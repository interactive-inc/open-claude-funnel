import {
  FunnelConnectorAdapter,
  type CallInput,
} from "@/modules/connectors/funnel-connector-adapter"
import { FunnelHttpClient } from "@/modules/http/funnel-http-client"
import { NodeFunnelHttpClient } from "@/modules/http/node-funnel-http-client"
import type { DiscordConnectorConfig } from "@/modules/connectors/discord-connector-schema"

const DISCORD_API_BASE = "https://discord.com/api/v10"

type Deps = {
  config: DiscordConnectorConfig
  http?: FunnelHttpClient
}

const defaultHttp = new NodeFunnelHttpClient()

export class FunnelDiscordAdapter extends FunnelConnectorAdapter {
  private readonly token: string
  private readonly http: FunnelHttpClient

  constructor(deps: Deps) {
    super()
    this.token = deps.config.botToken
    this.http = deps.http ?? defaultHttp
    Object.freeze(this)
  }

  async call(input: CallInput): Promise<unknown> {
    const method = (input.method || "GET").toUpperCase()
    const path = input.path.startsWith("/") ? input.path : `/${input.path}`
    const hasBody =
      input.body &&
      typeof input.body === "object" &&
      method !== "GET" &&
      Object.keys(input.body as object).length > 0

    const res = await this.http.fetch({
      method,
      url: `${DISCORD_API_BASE}${path}`,
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: hasBody ? JSON.stringify(input.body) : undefined,
    })

    if (!res.ok) {
      throw new Error(`Discord API failed (${res.status}): ${await res.text()}`)
    }

    if (res.status === 204) return null

    return await res.json()
  }
}
