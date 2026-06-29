import type { FlumeCatchupPolicy, FlumeTimeSourceState } from "@interactive-inc/flume"
import { FlumeTimeSource } from "@interactive-inc/flume"
import { defineChannel, type Channel, type ChannelTransform } from "@/engine/channel/channel"

type Options = {
  readonly id: string
  readonly name?: string
  readonly cron: string
  /** 既定: `{ mode: "lastOnly" }` (起動時に直近 1 件だけ取り戻す) */
  readonly catchupPolicy?: FlumeCatchupPolicy
  /**
   * 各 tick を broadcast payload に変換する関数。省略時は
   * `{ content: "tick", meta: { cron, firedAt } }` 相当
   */
  readonly transform?: ChannelTransform
  /**
   * `statePersister` を有効にするかどうか (既定 true)。`false` にすると catchup も無効
   */
  readonly persist?: boolean
}

/**
 * 1 cron entry の time channel を作る factory。
 *
 * 使用例 (inta jiho):
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
 * `persist: true` (既定) の場合、`<channelDir>/time.json` に `lastFiredAt` を残し、
 * 起動時に `catchupPolicy` (既定 lastOnly) に従って過去 tick を取り戻す
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
        statePersister: persist
          ? ctx.statePersister<FlumeTimeSourceState>("time")
          : undefined,
        catchupPolicy: persist ? catchupPolicy : { mode: "off" },
      })

      return {
        sources: [source],
        transform: options.transform,
      }
    },
  })
}
