import { FunnelConnectorAdapter, type CallInput } from "@/engine/connectors/connector-adapter"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import type { GhConnectorConfig } from "@/engine/connectors/gh-connector-schema"
import type { FunnelHttpClient } from "@/engine/http/http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"

type Deps = { config: GhConnectorConfig; http?: FunnelHttpClient; env?: NodeJS.ProcessEnv }

/** GitHub REST calls use the same explicit credential as the inbound connection. */
export class FunnelGhAdapter extends FunnelConnectorAdapter {
  private readonly token: string
  private readonly http: FunnelHttpClient
  constructor(deps: Deps) {
    super()
    this.token = resolveConnectorToken({
      literal: deps.config.token,
      envVar: deps.config.tokenEnv,
      env: deps.env ?? process.env,
      label: `${deps.config.name}.token`,
    })
    this.http = deps.http ?? new NodeFunnelHttpClient()
    Object.freeze(this)
  }
  async call(input: CallInput): Promise<unknown> {
    const method = (input.method || "GET").toUpperCase()
    const response = await this.http.fetch({
      method,
      url: `https://api.github.com/${input.path.replace(/^\/+/, "")}`,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body:
        method !== "GET" && method !== "HEAD" && input.body !== undefined
          ? JSON.stringify(input.body)
          : undefined,
    })
    if (!response.ok)
      throw new Error(`GitHub API failed (${response.status}): ${await response.text()}`)
    if (response.status === 204 || method === "HEAD") return null
    return response.json()
  }
}
