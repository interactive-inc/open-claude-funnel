import { z } from "zod"
import {
  publishRequestSchema,
  publishResponseSchema,
  type PublishRequest,
  type PublishResult,
} from "@/gateway/publish-schema"

const entrySchema = z.object({
  channelName: z.string(),
  channelId: z.string(),
  name: z.string(),
  type: z.string(),
  alive: z.boolean(),
  connected: z.boolean().optional(),
})
export type ListenerEntry = z.infer<typeof entrySchema>
const operationResponseSchema = z.object({ ok: z.boolean(), reason: z.string().optional() })
export type ListenerOpResult =
  | { state: "ok" }
  | { state: "offline" }
  | { state: "error"; reason: string }
export type ListListenersResult =
  | { state: "ok"; listeners: ListenerEntry[] }
  | Exclude<ListenerOpResult, { state: "ok" }>
type Options = {
  baseUrl: string
  /** Read the host's current credential for every request. */
  token: () => string | null
  isAvailable?: () => boolean
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

/** HTTP protocol client only. Does not launch a daemon, read files or own credentials. */
export class FunnelGatewayClient {
  private readonly base: string
  constructor(private readonly options: Options) {
    const url = new URL(options.baseUrl)
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("baseUrl must be an HTTP origin")
    this.base = url.origin
  }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = this.options.token()
    if (!token) throw new Error("gateway token is unavailable")
    return (this.options.fetch ?? fetch)(`${this.base}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    })
  }
  private available(): boolean {
    return this.options.isAvailable?.() ?? true
  }
  async list(): Promise<ListListenersResult> {
    try {
      if (!this.available()) return { state: "offline" }
      const response = await this.request("/listeners")
      if (!response.ok) return { state: "error", reason: `HTTP ${response.status}` }
      const body = z.object({ listeners: z.array(entrySchema) }).parse(await response.json())
      return { state: "ok", listeners: body.listeners }
    } catch (error) {
      return failure(error)
    }
  }
  start(channel: string, connector: string): Promise<ListenerOpResult> {
    return this.operation("POST", channel, connector, "/start")
  }
  stop(channel: string, connector: string): Promise<ListenerOpResult> {
    return this.operation("DELETE", channel, connector, "")
  }
  restart(channel: string, connector: string): Promise<ListenerOpResult> {
    return this.operation("POST", channel, connector, "/restart")
  }
  private async operation(
    method: string,
    channel: string,
    connector: string,
    suffix: string,
  ): Promise<ListenerOpResult> {
    try {
      if (!this.available()) return { state: "offline" }
      const response = await this.request(
        `/listeners/${encodeURIComponent(channel)}/${encodeURIComponent(connector)}${suffix}`,
        { method },
      )
      if (response.ok) {
        const body = operationResponseSchema.parse(await response.json())
        return body.ok
          ? { state: "ok" }
          : { state: "error", reason: body.reason ?? "listener operation failed" }
      }
      const body = z
        .object({ reason: z.string().optional() })
        .safeParse(await response.json().catch(() => null))
      return {
        state: "error",
        reason: (body.success ? body.data.reason : undefined) ?? `HTTP ${response.status}`,
      }
    } catch (error) {
      return failure(error)
    }
  }
  async publish(channel: string, input: PublishRequest): Promise<PublishResult> {
    try {
      if (!this.available()) return { state: "offline" }
      const response = await this.request(`/channels/${encodeURIComponent(channel)}/publish`, {
        method: "POST",
        body: JSON.stringify(publishRequestSchema.parse(input)),
      })
      if (!response.ok)
        return { state: "error", reason: `HTTP ${response.status}: ${await response.text()}` }
      return { state: "ok", offset: publishResponseSchema.parse(await response.json()).offset }
    } catch (error) {
      return failure(error)
    }
  }
}
function failure(error: unknown): { state: "error"; reason: string } {
  return { state: "error", reason: error instanceof Error ? error.message : String(error) }
}
