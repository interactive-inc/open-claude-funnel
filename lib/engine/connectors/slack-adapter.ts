import { FunnelConnectorAdapter, type CallInput } from "@/engine/connectors/connector-adapter"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import { FunnelHttpClient } from "@/engine/http/http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import type { SlackConnectorConfig } from "@/engine/connectors/slack-connector-schema"
import { serializeJsonBody } from "@/engine/connectors/serialize-json-body"

const SLACK_API_BASE = "https://slack.com/api/"

type Deps = {
  config: SlackConnectorConfig
  env?: NodeJS.ProcessEnv
  /** HTTP client injection — defaults to `NodeFunnelHttpClient`. Tests inject `MemoryFunnelHttpClient`. */
  http?: FunnelHttpClient
}

/**
 * Slack Web API adapter over the injected `FunnelHttpClient`. `call()` posts
 * to `https://slack.com/api/<method>` with `Authorization: Bearer <botToken>`
 * and returns the parsed JSON body verbatim — Slack signals failures with
 * `{ ok: false, error: "..." }` in a 200 response, so we surface that body
 * unchanged and let the caller inspect `ok`.
 */
export class FunnelSlackAdapter extends FunnelConnectorAdapter {
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
    this.http = deps.http ?? new NodeFunnelHttpClient()
    Object.freeze(this)
  }

  async call(input: CallInput): Promise<unknown> {
    const signal = input.signal
    signal?.throwIfAborted()
    const url = `${SLACK_API_BASE}${input.path}`
    signal?.throwIfAborted()
    const body = input.body
    signal?.throwIfAborted()
    const form = new URLSearchParams()

    for (const [key, value] of Object.entries(
      body !== null && typeof body === "object" ? body : {},
    )) {
      form.set(key, typeof value === "string" ? value : serializeJsonBody(value))
    }

    const request = {
      method: "POST",
      url,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal,
    }
    signal?.throwIfAborted()
    const res = await this.http.fetch(request)
    signal?.throwIfAborted()

    const text = await res.text()
    signal?.throwIfAborted()

    try {
      return JSON.parse(text)
    } catch {
      return { ok: false, error: `non-JSON response: ${text.slice(0, 200)}` }
    }
  }

  async postMessage(props: { channel: string; text: string; threadTs?: string }): Promise<unknown> {
    return this.call({
      method: "post",
      path: "chat.postMessage",
      body: {
        channel: props.channel,
        text: props.text,
        ...(props.threadTs ? { thread_ts: props.threadTs } : {}),
      },
    })
  }

  async addReaction(props: { channel: string; timestamp: string; name: string }): Promise<unknown> {
    return this.call({
      method: "post",
      path: "reactions.add",
      body: { channel: props.channel, timestamp: props.timestamp, name: props.name },
    })
  }

  async removeReaction(props: {
    channel: string
    timestamp: string
    name: string
  }): Promise<unknown> {
    return this.call({
      method: "post",
      path: "reactions.remove",
      body: { channel: props.channel, timestamp: props.timestamp, name: props.name },
    })
  }
}
