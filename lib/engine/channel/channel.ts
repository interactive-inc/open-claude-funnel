import type { FlumeEvent, FlumeSource, FlumeStatePersister } from "@interactive-inc/flume"
import type { FunnelClock } from "@/engine/time/clock"
import type { FunnelFileSystem } from "@/engine/fs/file-system"
import type { FunnelLogger } from "@/engine/logger/logger"

/**
 * 1 tick / 1 event を `broadcaster.broadcast(content, meta)` に流すための整形済みペイロード。
 * `null` を返すと「drop」(broadcast しない) を意味する
 */
export type ChannelBroadcastPayload = {
  readonly content: string
  readonly meta?: Record<string, string>
}

export type ChannelTransform = (event: FlumeEvent) => ChannelBroadcastPayload | null

/**
 * Channel が `build(ctx)` で返す実体。flume sources の集合と任意の transform を 1 まとまりとして
 * supervisor に渡す
 */
export type ChannelRuntime = {
  readonly sources: ReadonlyArray<FlumeSource>
  /**
   * 各 source の FlumeEvent を broadcast payload に変換する関数。
   * 省略時は `{ content: JSON.stringify(event.data), meta: event.meta }` でフォールバック
   */
  readonly transform?: ChannelTransform
}

/**
 * Channel.build に渡される環境。FunnelClock / FunnelLogger / FunnelFileSystem を経由して
 * IO 境界を抽象化する。statePersister は funnel-fs に紐づいた `FlumeStatePersister<S>` を
 * channel id-scoped なファイル名で生成するヘルパー
 */
export type ChannelBuildContext = {
  readonly channelId: string
  readonly channelName: string
  readonly signal: AbortSignal
  readonly logger: FunnelLogger
  readonly clock: FunnelClock
  readonly fs: FunnelFileSystem
  /**
   * `<funnelDir>/channels/<channelId>/<filename>.json` に Read/Write する純粋 DI 用 helper。
   * flume が要求する `FlumeStatePersister<S>` 形に合わせる
   */
  readonly statePersister: <S>(filename: string) => FlumeStatePersister<S>
}

/**
 * 1 channel = 1 inbound 受信単位。`build` が confluence に挿す sources を返す。
 * `build` は host abort / token rotation 等で何度でも再呼び出しされうる「純粋なファクトリ」
 */
export type Channel = {
  readonly id: string
  readonly name?: string
  readonly build: (ctx: ChannelBuildContext) => ChannelRuntime | Promise<ChannelRuntime>
}

/** `Channel` を frozen で返す identity helper。consumer の型推論を整える */
export function defineChannel(channel: Channel): Channel {
  return Object.freeze({ ...channel })
}
