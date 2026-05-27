import { FunnelConnectorAdapter, type CallInput } from "@/connectors/connector-adapter"
import { resolveConnectorToken } from "@/connectors/resolve-connector-token"
import { FunnelHttpClient } from "@/engine/http/http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import type { DiscordConnectorConfig } from "@/connectors/discord-connector-schema"

const DISCORD_API_BASE = "https://discord.com/api/v10"

type Deps = {
  config: DiscordConnectorConfig
  /** Environment used to resolve a `botTokenEnv` reference. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
  http?: FunnelHttpClient
}

const defaultHttp = new NodeFunnelHttpClient()

export class FunnelDiscordAdapter extends FunnelConnectorAdapter {
  private readonly token: string
  private readonly http: FunnelHttpClient

  constructor(deps: Deps) {
    super()
    this.token = resolveConnectorToken({
      literal: deps.config.botToken,
      envVar: deps.config.botTokenEnv,
      env: deps.env ?? process.env,
      label: `${deps.config.name}.botToken`,
    })
    this.http = deps.http ?? defaultHttp
    Object.freeze(this)
  }

  async call(input: CallInput): Promise<unknown> {
    const method = (input.method || "GET").toUpperCase()
    const path = input.path.startsWith("/") ? input.path : `/${input.path}`
    const body = input.body
    const hasBody =
      body !== null && typeof body === "object" && method !== "GET" && Object.keys(body).length > 0

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
