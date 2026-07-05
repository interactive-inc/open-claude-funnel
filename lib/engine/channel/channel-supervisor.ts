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
import type {
  Channel,
  ChannelBroadcastPayload,
  ChannelBroadcastSink,
  ChannelRuntime,
} from "@/engine/channel/channel"
import { createChannelStatePersisterFactory } from "@/engine/channel/channel-state-persister-factory"

type Props = {
  readonly broadcaster: ChannelBroadcastSink
  readonly logger: FunnelLogger
  readonly clock: FunnelClock
  readonly fs: FunnelFileSystem
  /**
   * Root for per-channel state files. Writes go under
   * `<root>/channels/<channelId>/`
   */
  readonly dir: string
  readonly deps?: FlumeRuntimeDeps
  readonly onError?: FlumeErrorHandler
  /** Host abort. Once fired the supervisor closes every channel and goes inert */
  readonly signal?: AbortSignal
}

type Registered = {
  readonly channel: Channel
  readonly runtime: ChannelRuntime
  readonly abortController: AbortController
}

/**
 * Maps the Channel manifest onto a single `FlumeConfluence`.
 *
 *  - channels accepted via `register(channel)` are `build(ctx)`-ed on `start()`
 *    and their sources inserted with `add(channelId, sources)`
 *  - the confluence onItem stream (tagged with groupId) is routed through the
 *    owning channel's `transform`, then into `broadcaster.broadcast(content, meta)`
 *  - `unregister(id)` stops one channel, `stop()` stops them all
 *
 * Independent from the ConnectorDescriptor system (`FunnelListenerRegistry`);
 * the two run side-by-side so callers can migrate incrementally
 */
export class FunnelChannelSupervisor {
  private readonly confluence: FlumeConfluence

  private readonly registered = new Map<string, Registered>()

  private readonly pending = new Map<string, Channel>()

  private readonly opening = new Map<string, Promise<void>>()

  private started = false

  private aborted = false

  constructor(private readonly props: Props) {
    this.confluence = new FlumeConfluence({
      onEvent: (item) => this.handleItem(item),
      onError: props.onError,
      deps: props.deps,
    })

    if (props.signal) {
      if (props.signal.aborted) {
        this.aborted = true
      } else {
        const onAbort = (): void => {
          this.aborted = true
          this.stop().catch(() => {})
        }
        props.signal.addEventListener("abort", onAbort, { once: true })
      }
    }
  }

  /**
   * Accepted before or after start (post-start registers open immediately,
   * tracked in `opening` until settled). No-op once the host signal aborted
   */
  register(channel: Channel): void {
    if (this.aborted) return

    if (this.has(channel.id)) {
      throw new Error(`FunnelChannelSupervisor: channel id already registered: ${channel.id}`)
    }

    if (!this.started) {
      this.pending.set(channel.id, channel)
      return
    }

    const open = this.openChannel(channel).finally(() => {
      this.opening.delete(channel.id)
    })

    this.opening.set(channel.id, open)
  }

  /** Waits for an in-flight post-start open of the same id before removing */
  async unregister(id: string): Promise<void> {
    this.pending.delete(id)

    const open = this.opening.get(id)
    if (open) await open

    const entry = this.registered.get(id)
    if (!entry) return

    this.registered.delete(id)
    entry.abortController.abort()
    await this.confluence.remove(id)
  }

  async start(): Promise<void> {
    if (this.started || this.aborted) return
    this.started = true

    const channels = [...this.pending.values()]
    this.pending.clear()

    for (const channel of channels) {
      await this.openChannel(channel)
    }
  }

  async stop(): Promise<void> {
    this.started = false
    this.pending.clear()

    await Promise.all(this.opening.values())

    for (const entry of this.registered.values()) entry.abortController.abort()
    this.registered.clear()
    await this.confluence.closeAll()
  }

  ids(): ReadonlyArray<string> {
    return [...this.registered.keys()]
  }

  has(id: string): boolean {
    return this.registered.has(id) || this.pending.has(id) || this.opening.has(id)
  }

  /** Never rejects: build/add failures are logged and the channel is skipped */
  private async openChannel(channel: Channel): Promise<void> {
    const abortController = new AbortController()

    const runtime = await this.buildRuntime(channel, abortController.signal)
    if (runtime instanceof Error) {
      this.props.logger.error(`channel "${channel.id}" failed to build`, {
        error: runtime.message,
      })
      abortController.abort()
      return
    }

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

  private async buildRuntime(channel: Channel, signal: AbortSignal): Promise<ChannelRuntime | Error> {
    const channelDir = join(this.props.dir, "channels", channel.id)

    try {
      return await channel.build({
        channelId: channel.id,
        channelName: channel.name ?? channel.id,
        signal,
        logger: this.props.logger,
        clock: this.props.clock,
        fs: this.props.fs,
        statePersister: createChannelStatePersisterFactory({ fs: this.props.fs, channelDir }),
      })
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  }

  private handleItem(item: FlumeConfluenceItem): void {
    if (item.kind !== "event") return

    const entry = this.registered.get(item.groupId)
    if (!entry) return

    const payload = this.transformToPayload(entry, item.event)
    if (payload === null) return

    this.props.broadcaster.broadcast(payload.content, payload.meta)
  }

  /** Never throws: a throwing user transform is logged and the event dropped */
  private transformToPayload(entry: Registered, event: FlumeEvent): ChannelBroadcastPayload | null {
    const transform = entry.runtime.transform
    if (transform === undefined) {
      return { content: JSON.stringify(event.data), meta: event.meta }
    }

    try {
      return transform(event)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.props.logger.error(`channel "${entry.channel.id}" transform threw`, { error: message })
      return null
    }
  }
}
