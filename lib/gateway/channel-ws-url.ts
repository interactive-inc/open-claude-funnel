/**
 * Builds the WebSocket URL a client uses to subscribe to a gateway channel.
 *
 * The gateway's `/ws` upgrade handler reads three query params — `channel`
 * (required), `id` (the subscriber id for targeted delivery), and `since`
 * (replay offset). Forgetting `channel=` silently drops the subscription
 * (the broadcaster never matches the client), which has caused outages when
 * callers hand-built the URL with string concatenation. This builder makes
 * `channel` a required field, so the mistake becomes a compile error.
 *
 * `subscriberId` enables targeted delivery: events carrying `meta.target=<id>`
 * reach only this client. Exclusive replay requires a stable subscriberId;
 * omitting it permits live delivery only for exclusive channels.
 *
 * Pair with `channelWsProtocols()` to authenticate the upgrade when the
 * gateway requires a token.
 */
export type ChannelWsUrlInput = {
  /** Base WS endpoint, e.g. `ws://localhost:9743/ws`. Existing query is preserved. */
  base: string
  /** Channel name to subscribe to. Required — the broadcaster filters by it. */
  channel: string
  /** Opaque subscriber id for targeted delivery (`meta.target=<id>`). Omit for fanout. */
  subscriberId?: string
  /** Replay events strictly after this offset. Omit to receive only new events. */
  since?: number
}

export function channelWsUrl(input: ChannelWsUrlInput): string {
  const url = new URL(input.base)

  url.searchParams.set("channel", input.channel)

  if (input.subscriberId !== undefined) {
    url.searchParams.set("id", input.subscriberId)
  }

  if (input.since !== undefined) {
    url.searchParams.set("since", String(input.since))
  }

  return url.toString()
}

/**
 * Builds the `Sec-WebSocket-Protocol` values that authenticate a gateway WS
 * upgrade. Browser `WebSocket` cannot set an `Authorization` header, so the
 * gateway also accepts the token as a `funnel.token.<token>` subprotocol.
 * Returns an empty array when no token is given (auth disabled / loopback).
 *
 * Usage: `new WebSocket(channelWsUrl({ base, channel }), channelWsProtocols(token))`
 */
export function channelWsProtocols(token?: string | null): string[] {
  if (!token) return []

  return [`funnel.token.${token}`]
}
