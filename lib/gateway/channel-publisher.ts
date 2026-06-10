import { gatewayLoopbackUrl } from "@/engine/http/gateway-base-url"
import {
  publishResponseSchema,
  type PublishRequest,
  type PublishResult,
} from "@/gateway/publish-schema"

type Deps = {
  port: number
  isDaemonRunning: () => boolean
  /** Returns the daemon's gateway token, or null if unavailable. Sent as `Authorization: Bearer`. */
  getToken?: () => string | null
}

const OFFLINE: PublishResult = { state: "offline" }

/**
 * HTTP client for `POST /channels/:channel/publish` on a running gateway
 * daemon. Returns `{ state: "offline" }` when the daemon isn't up so callers
 * can branch without exceptions, mirroring `FunnelListenersClient`.
 */
export class FunnelChannelPublisher {
  private readonly port: number
  private readonly isDaemonRunning: () => boolean
  private readonly getToken: () => string | null

  constructor(deps: Deps) {
    this.port = deps.port
    this.isDaemonRunning = deps.isDaemonRunning
    this.getToken = deps.getToken ?? (() => null)
    Object.freeze(this)
  }

  async publish(channelName: string, request: PublishRequest): Promise<PublishResult> {
    if (!this.isDaemonRunning()) return OFFLINE

    try {
      const url = `${gatewayLoopbackUrl(this.port)}/channels/${encodeURIComponent(channelName)}/publish`
      const res = await fetch(url, {
        method: "POST",
        headers: { ...this.authHeaders(), "content-type": "application/json" },
        body: JSON.stringify(request),
      })

      if (!res.ok) {
        const text = await res.text()

        return { state: "error", reason: text || `HTTP ${res.status}` }
      }

      const parsed = publishResponseSchema.safeParse(await res.json())

      if (!parsed.success) {
        return { state: "error", reason: "malformed daemon response" }
      }

      return { state: "ok", offset: parsed.data.offset }
    } catch (error) {
      return { state: "error", reason: error instanceof Error ? error.message : String(error) }
    }
  }

  private authHeaders(): Record<string, string> {
    const token = this.getToken()

    return token ? { authorization: `Bearer ${token}` } : {}
  }
}
