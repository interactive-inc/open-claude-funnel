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
   * Converts each tick into a broadcast payload. Defaults to the equivalent of
   * `{ content: "tick", meta: { cron, firedAt } }`
   */
  readonly transform?: ChannelTransform
  /** Optional host-owned state. Catch-up is disabled when absent. */
  readonly statePersister?: FlumeStatePersister<FlumeTimeSourceState>
}

/** Optional time source. Catch-up persistence is supplied by the host. */
export function timeChannel(options: Options): Channel {
  const persist = options.statePersister !== undefined
  const catchupPolicy: FlumeCatchupPolicy = options.catchupPolicy ?? { mode: "lastOnly" }

  return defineChannel({
    id: options.id,
    name: options.name ?? options.id,
    build: () => {
      const source = new FlumeTimeSource({
        cron: options.cron,
        statePersister: options.statePersister,
        catchupPolicy: persist ? catchupPolicy : { mode: "off" },
      })

      return {
        sources: [source],
        transform: options.transform,
      }
    },
  })
}
