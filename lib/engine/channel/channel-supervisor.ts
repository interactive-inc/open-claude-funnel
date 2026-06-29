import type {
  FlumeConfluenceItem,
  FlumeErrorHandler,
  FlumeEvent,
  FlumeRuntimeDeps,
} from "@interactive-inc/flume"
import { FlumeConfluence } from "@interactive-inc/flume"
import { join } from "node:path"
import type { FunnelClock } from "@/engine/time/clock"
import type { FunnelFileSystem } from "@/engine/fs/file-system"
import type { FunnelLogger } from "@/engine/logger/logger"
import type { FunnelBroadcaster } from "@/gateway/broadcaster"
import type { Channel, ChannelRuntime } from "@/engine/channel/channel"
import { createChannelStatePersisterFactory } from "@/engine/channel/file-state-persister"

type Props = {
  readonly broadcaster: FunnelBroadcaster
  readonly logger: FunnelLogger
  readonly clock: FunnelClock
  readonly fs: FunnelFileSystem
  /**
   * Channel ごとの state / 永続化ファイルの起点。
   * `<root>/channels/<channelId>/` 配下に書き込む
   */
  readonly dir: string
  readonly deps?: FlumeRuntimeDeps
  readonly onError?: FlumeErrorHandler
  /** Host abort. fired すると全 channel を close する */
  readonly signal?: AbortSignal
}

type Registered = {
  readonly channel: Channel
  readonly runtime: ChannelRuntime
  readonly abortController: AbortController
}

/**
 * Channel-manifest を `FlumeConfluence` 1 つにマッピングする supervisor。
 *
 *  - `register(channel)` で受け入れた channel は `start()` 時に `build(ctx)` され
 *    sources が confluence に `add(channelId, sources)` で挿される
 *  - confluence の onItem (groupId 付き) を 1 本受けて、対応する channel の `transform`
 *    を通してから `broadcaster.broadcast(content, meta)` に流す
 *  - `unregister(id)` で個別停止、`stop()` で全停止
 *
 * 既存の `FunnelListenerRegistry` (ConnectorDescriptor 系) とは独立。
 * 並走させて段階的に移行する設計
 */
export class FunnelChannelSupervisor {
  private readonly confluence: FlumeConfluence

  private readonly registered = new Map<string, Registered>()

  private readonly pending = new Map<string, Channel>()

  private started = false

  constructor(private readonly props: Props) {
    this.confluence = new FlumeConfluence({
      onEvent: (item) => this.handleItem(item),
      onError: props.onError,
      deps: props.deps,
    })

    if (props.signal) {
      const onAbort = (): void => {
        this.stop().catch(() => {})
      }
      if (props.signal.aborted) {
        // host が既に abort 済み。後で start() しても何も挿さない
        this.started = true
      } else {
        props.signal.addEventListener("abort", onAbort, { once: true })
      }
    }
  }

  /** start 前 / 後どちらでも受け付ける。start 後は即座に build + add する */
  register(channel: Channel): void {
    if (this.registered.has(channel.id) || this.pending.has(channel.id)) {
      throw new Error(`FunnelChannelSupervisor: channel id already registered: ${channel.id}`)
    }

    if (!this.started) {
      this.pending.set(channel.id, channel)
      return
    }

    void this.openChannel(channel)
  }

  async unregister(id: string): Promise<void> {
    this.pending.delete(id)

    const entry = this.registered.get(id)
    if (!entry) return

    this.registered.delete(id)
    entry.abortController.abort()
    await this.confluence.remove(id)
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    const channels = [...this.pending.values()]
    this.pending.clear()

    for (const channel of channels) {
      await this.openChannel(channel)
    }
  }

  async stop(): Promise<void> {
    this.started = false
    for (const entry of this.registered.values()) entry.abortController.abort()
    this.registered.clear()
    this.pending.clear()
    await this.confluence.closeAll()
  }

  ids(): ReadonlyArray<string> {
    return [...this.registered.keys()]
  }

  has(id: string): boolean {
    return this.registered.has(id) || this.pending.has(id)
  }

  private async openChannel(channel: Channel): Promise<void> {
    const channelDir = join(this.props.dir, "channels", channel.id)
    const abortController = new AbortController()

    const runtime = await channel.build({
      channelId: channel.id,
      channelName: channel.name ?? channel.id,
      signal: abortController.signal,
      logger: this.props.logger,
      clock: this.props.clock,
      fs: this.props.fs,
      statePersister: createChannelStatePersisterFactory({ fs: this.props.fs, channelDir }),
    })

    const result = await this.confluence.add(channel.id, runtime.sources)
    if (result instanceof Error) {
      this.props.logger.error(`channel "${channel.id}" failed to start`, {
        error: result.message,
      })
      abortController.abort()
      return
    }

    this.registered.set(channel.id, { channel, runtime, abortController })
  }

  private handleItem(item: FlumeConfluenceItem): void {
    if (item.kind !== "event") return

    const entry = this.registered.get(item.groupId)
    if (!entry) return

    const payload = this.transformToPayload(entry, item.event)
    if (payload === null) return

    this.props.broadcaster.broadcast(payload.content, payload.meta)
  }

  private transformToPayload(
    entry: Registered,
    event: FlumeEvent,
  ): { content: string; meta?: Record<string, string> } | null {
    const transform = entry.runtime.transform
    if (transform === undefined) {
      return { content: JSON.stringify(event.data), meta: event.meta }
    }

    const out = transform(event)
    if (out === null) return null

    return { content: out.content, meta: out.meta }
  }
}
