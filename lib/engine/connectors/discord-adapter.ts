import { FunnelConnectorAdapter, type CallInput } from "@/engine/connectors/connector-adapter"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import { FunnelHttpClient } from "@/engine/http/http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import type { DiscordConnectorConfig } from "@/engine/connectors/discord-connector-schema"
import { serializeJsonBody } from "@/engine/connectors/serialize-json-body"

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
    const signal = input.signal
    signal?.throwIfAborted()
    const method = (input.method || "GET").toUpperCase()
    const requestedPath = input.path
    const path = requestedPath.startsWith("/") ? requestedPath : `/${requestedPath}`
    const body = method !== "GET" && method !== "HEAD" ? input.body : undefined

    const request = {
      method,
      url: `${DISCORD_API_BASE}${path}`,
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? serializeJsonBody(body) : undefined,
      signal,
    }
    signal?.throwIfAborted()
    const res = await this.http.fetch(request)
    signal?.throwIfAborted()

    if (!res.ok) {
      const detail = await res.text()
      signal?.throwIfAborted()
      throw new Error(`Discord API failed (${res.status}): ${detail}`)
    }

    if (res.status === 204 || res.status === 205 || method === "HEAD") {
      signal?.throwIfAborted()
      return null
    }

    const result = await res.json()
    signal?.throwIfAborted()
    return result
  }
}
