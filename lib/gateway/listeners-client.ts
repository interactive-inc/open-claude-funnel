import { z } from "zod"
import { gatewayLoopbackUrl } from "@/engine/http/gateway-base-url"
import { loopbackFetch } from "@/engine/http/loopback-fetch"

type Deps = {
  port: number
  isDaemonRunning: () => boolean
  /** Returns the daemon's gateway token, or null if unavailable. Sent as `Authorization: Bearer`. */
  getToken?: () => string | null
}

const listenerEntrySchema = z.object({
  channelName: z.string(),
  channelId: z.string(),
  name: z.string(),
  type: z.string(),
  alive: z.boolean(),
})

const listenersResponseSchema = z.object({
  listeners: z.array(listenerEntrySchema),
})

const opErrorBodySchema = z.object({
  reason: z.string().optional(),
})

export type ListenerEntry = z.infer<typeof listenerEntrySchema>

export type ListenerOpResult =
  | { state: "ok" }
  | { state: "offline" }
  | { state: "error"; reason: string }

export type ListListenersResult =
  | { state: "ok"; listeners: ListenerEntry[] }
  | { state: "offline" }
  | { state: "error"; reason: string }

const OFFLINE: ListenerOpResult = { state: "offline" }

/**
 * HTTP client for listener operations on a running gateway daemon.
 *
 * Returns `{ state: "offline" }` when the daemon isn't running so callers
 * (CLI hot-reload paths) can treat that as a no-op without parsing strings.
 * Pair this with `FunnelGateway` (process control) for the full picture.
 */
export class FunnelListenersClient {
  private readonly port: number
  private readonly isDaemonRunning: () => boolean
  private readonly getToken: () => string | null

  constructor(deps: Deps) {
    this.port = deps.port
    this.isDaemonRunning = deps.isDaemonRunning
    this.getToken = deps.getToken ?? (() => null)
    Object.freeze(this)
  }

  async list(): Promise<ListListenersResult> {
    if (!this.isDaemonRunning()) return { state: "offline" }

    try {
      const res = await loopbackFetch(`${gatewayLoopbackUrl(this.port)}/listeners`, {
        headers: this.authHeaders(),
      })

      if (!res.ok) return { state: "error", reason: `HTTP ${res.status}` }

      const parsed = listenersResponseSchema.safeParse(await res.json())

      if (!parsed.success) {
        return { state: "error", reason: "malformed daemon response" }
      }

      return { state: "ok", listeners: parsed.data.listeners }
    } catch (error) {
      return { state: "error", reason: error instanceof Error ? error.message : String(error) }
    }
  }

  async start(channelName: string, connectorName: string): Promise<ListenerOpResult> {
    if (!this.isDaemonRunning()) return OFFLINE

    return await this.call("POST", `/listeners/${this.path(channelName, connectorName)}/start`)
  }

  async stop(channelName: string, connectorName: string): Promise<ListenerOpResult> {
    if (!this.isDaemonRunning()) return OFFLINE

    return await this.call("DELETE", `/listeners/${this.path(channelName, connectorName)}`)
  }

  async restart(channelName: string, connectorName: string): Promise<ListenerOpResult> {
    if (!this.isDaemonRunning()) return OFFLINE

    return await this.call("POST", `/listeners/${this.path(channelName, connectorName)}/restart`)
  }

  private path(channelName: string, connectorName: string): string {
    return `${encodeURIComponent(channelName)}/${encodeURIComponent(connectorName)}`
  }

  private authHeaders(): Record<string, string> {
    const token = this.getToken()

    return token ? { authorization: `Bearer ${token}` } : {}
  }

  private async call(method: "POST" | "DELETE", path: string): Promise<ListenerOpResult> {
    try {
      // 30s ceiling for listener start/stop/restart — Slack Socket Mode
      // handshake can take a few seconds, GH poll bootstrap likewise. Bump if
      // a real connector grows beyond that.
      const res = await loopbackFetch(
        `${gatewayLoopbackUrl(this.port)}${path}`,
        { method, headers: this.authHeaders() },
        30_000,
      )

      if (!res.ok) {
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          body = null
        }
        const parsed = opErrorBodySchema.safeParse(body)
        const reason = parsed.success ? parsed.data.reason : undefined

        return { state: "error", reason: reason ?? `HTTP ${res.status}` }
      }

      return { state: "ok" }
    } catch (error) {
      return { state: "error", reason: error instanceof Error ? error.message : String(error) }
    }
  }
}
