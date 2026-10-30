import type { FlumeEvent, FlumeSource } from "@interactive-inc/flume"
import type { FunnelClock } from "@/engine/time/clock"
import type { FunnelLogger } from "@/engine/logger/logger"

/**
 * Payload shaped for `broadcaster.broadcast(content, meta)`. A transform
 * returning `null` means "drop" (do not broadcast)
 */
export type ChannelBroadcastPayload = {
  readonly content: string
  readonly meta?: Record<string, string>
}

/** Synchronous conversion to string content and string metadata values.
 * Invalid or asynchronous results are reported and dropped before delivery. */
export type ChannelTransform = (event: FlumeEvent) => ChannelBroadcastPayload | null

/**
 * Narrow broadcast seam the supervisor depends on. The gateway
 * `FunnelBroadcaster` satisfies it structurally, so the engine layer never
 * imports from the gateway layer
 */
export type ChannelBroadcastSink = {
  broadcast(content: string, meta?: Record<string, string>): void
}

/**
 * What `Channel.build(ctx)` returns: the flume sources to run plus an optional
 * transform, handed to the supervisor as one unit
 */
export type ChannelRuntime = {
  readonly sources: ReadonlyArray<FlumeSource>
  /**
   * Converts each source's FlumeEvent into a broadcast payload. Defaults to
   * `{ content: JSON.stringify(event.data), meta: event.meta }` when omitted
   * Data that cannot produce a JSON string is reported and dropped.
   */
  readonly transform?: ChannelTransform
}

/** Host context for building source connections. State is provided to sources explicitly. */
export type ChannelBuildContext = {
  readonly channelId: string
  readonly channelName: string
  readonly signal: AbortSignal
  readonly logger: FunnelLogger
  readonly clock: FunnelClock
}

/**
 * One channel = one inbound intake unit. `build` returns the sources to plug
 * into the confluence and may be re-invoked any number of times (host abort,
 * token rotation, ...) — treat it as a pure factory
 */
export type Channel = {
  readonly id: string
  readonly name?: string
  readonly build: (ctx: ChannelBuildContext) => ChannelRuntime | Promise<ChannelRuntime>
}

/** Frozen manifest snapshot that preserves the original factory receiver. */
export function defineChannel(channel: Channel): Channel {
  const { id, name, build } = channel
  return Object.freeze({
    id,
    name,
    build: (ctx: ChannelBuildContext) => build.call(channel, ctx),
  })
}
