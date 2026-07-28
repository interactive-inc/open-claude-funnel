import type { FlumeCatchupPolicy, FlumeTimeSourceState } from "@interactive-inc/flume"
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
  /**
   * Whether to enable `statePersister` (default true). `false` also disables
   * catchup
   */
  readonly persist?: boolean
}

/**
 * Factory for a single-cron-entry time channel.
 *
 * Example (inta jiho):
 * ```ts
 * const jiho = timeChannel({
 *   id: "inta-jiho",
 *   cron: "0 * * * *",
 *   transform: (event) => ({
 *     content: `⏰ ${new Date(event.data.firedAt as number).getHours()}時をお知らせします。`,
 *     meta: { event_type: "schedule", source: "inta-jiho", target_role: "primary" },
 *   }),
 * })
 * ```
 *
 * With `persist: true` (default), `lastFiredAt` is kept in `<channelDir>/time.json`
 * and missed ticks are recovered on startup according to `catchupPolicy`
 * (default lastOnly)
 */
export function timeChannel(options: Options): Channel {
  const persist = options.persist ?? true
  const catchupPolicy: FlumeCatchupPolicy = options.catchupPolicy ?? { mode: "lastOnly" }

  return defineChannel({
    id: options.id,
    name: options.name ?? options.id,
    build: (ctx) => {
      const source = new FlumeTimeSource({
        cron: options.cron,
        statePersister: persist ? ctx.statePersister<FlumeTimeSourceState>("time") : undefined,
        catchupPolicy: persist ? catchupPolicy : { mode: "off" },
      })

      return {
        sources: [source],
        transform: options.transform,
      }
    },
  })
}
