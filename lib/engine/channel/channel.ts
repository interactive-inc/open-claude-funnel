import type { FlumeEvent, FlumeSource, FlumeStatePersister } from "@interactive-inc/flume"
import type { FunnelClock } from "@/engine/time/clock"
import type { FunnelFileSystem } from "@/engine/fs/file-system"
import type { FunnelLogger } from "@/engine/logger/logger"

/**
 * Payload shaped for `broadcaster.broadcast(content, meta)`. A transform
 * returning `null` means "drop" (do not broadcast)
 */
export type ChannelBroadcastPayload = {
  readonly content: string
  readonly meta?: Record<string, string>
}

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
   */
  readonly transform?: ChannelTransform
}

/**
 * Environment passed to `Channel.build`. IO boundaries stay abstract via
 * FunnelClock / FunnelLogger / FunnelFileSystem. `statePersister` builds a
 * funnel-fs-backed `FlumeStatePersister<S>` scoped to the channel id
 */
export type ChannelBuildContext = {
  readonly channelId: string
  readonly channelName: string
  readonly signal: AbortSignal
  readonly logger: FunnelLogger
  readonly clock: FunnelClock
  readonly fs: FunnelFileSystem
  /**
   * Reads/writes `<funnelDir>/channels/<channelId>/<filename>.json` in the
   * `FlumeStatePersister<S>` shape flume expects
   */
  readonly statePersister: <S>(filename: string) => FlumeStatePersister<S>
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

/** Frozen identity helper that keeps consumer type inference tidy */
export function defineChannel(channel: Channel): Channel {
  return Object.freeze({ ...channel })
}
