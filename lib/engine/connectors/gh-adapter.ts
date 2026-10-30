import { FunnelConnectorAdapter, type CallInput } from "@/engine/connectors/connector-adapter"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import type { GhConnectorConfig } from "@/engine/connectors/gh-connector-schema"
import type { FunnelHttpClient } from "@/engine/http/http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import { serializeJsonBody } from "@/engine/connectors/serialize-json-body"
import { readHttpErrorDetail } from "@/read-http-error-detail"

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
    const signal = input.signal
    signal?.throwIfAborted()
    const method = (input.method || "GET").toUpperCase()
    signal?.throwIfAborted()
    const path = input.path.replace(/^\/+/, "")
    signal?.throwIfAborted()
    const body = method !== "GET" && method !== "HEAD" ? input.body : undefined
    signal?.throwIfAborted()
    const request = {
      method,
      url: `https://api.github.com/${path}`,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: body !== undefined ? serializeJsonBody(body) : undefined,
      signal,
    }
    signal?.throwIfAborted()
    const response = await this.http.fetch(request)
    signal?.throwIfAborted()
    if (!response.ok) {
      const detail = await readHttpErrorDetail(response)
      signal?.throwIfAborted()
      throw new Error(`GitHub API failed (${response.status}): ${detail}`)
    }
    if (response.status === 204 || response.status === 205 || method === "HEAD") {
      signal?.throwIfAborted()
      return null
    }
    const result = await response.json()
    signal?.throwIfAborted()
    return result
  }
}
