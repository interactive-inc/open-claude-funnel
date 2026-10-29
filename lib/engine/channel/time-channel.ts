import type {
  FlumeCatchupPolicy,
  FlumeTimeSourceState,
  FlumeStatePersister,
} from "@interactive-inc/flume"
import { FlumeTimeSource } from "@interactive-inc/flume/time"
import { defineChannel, type Channel, type ChannelTransform } from "@/engine/channel/channel"

type Options = {
  readonly id: string
  readonly name?: string
  readonly cron: string
  /** Default: `{ mode: "lastOnly" }` (recover only the most recent missed tick on startup) */
  readonly catchupPolicy?: FlumeCatchupPolicy
  /**
   * Converts each tick into a broadcast payload. When omitted, content is
   * JSON.stringify(event.data) and event.meta is forwarded unchanged.
   * Default tick data contains firedAt (epoch milliseconds) and cron.
   */
  readonly transform?: ChannelTransform
  /** Optional host-owned state. Catch-up is disabled when absent. */
  readonly statePersister?: FlumeStatePersister<FlumeTimeSourceState>
}

/** Optional time source. Catch-up persistence is supplied by the host. */
export function timeChannel(options: Options): Channel {
  const { id, name, cron, transform, statePersister } = options
  const policy = options.catchupPolicy ?? { mode: "lastOnly" }
  const mode = policy.mode
  const catchupPolicy: FlumeCatchupPolicy =
    mode === "missed" ? { mode, maxWindowMs: policy.maxWindowMs } : { mode }

  return defineChannel({
    id,
    name: name ?? id,
    build: () => {
      const source = new FlumeTimeSource({
        cron,
        statePersister,
        catchupPolicy: statePersister !== undefined ? catchupPolicy : { mode: "off" },
      })

      return {
        sources: [source],
        transform,
      }
    },
  })
}
