import { ObservedFunnelLogger } from "@/engine/logger/observed-logger"
import type { FlumeErrorHandler, FlumeRuntimeDeps } from "@interactive-inc/flume"
import type { FunnelClock } from "@/engine/time/clock"
import type { FunnelLogger } from "@/engine/logger/logger"
import type { Channel, ChannelBroadcastSink } from "@/engine/channel/channel"
import { FunnelChannelListener } from "@/engine/channel/channel-listener"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"

type Props = {
  readonly broadcaster: ChannelBroadcastSink
  readonly logger: FunnelLogger
  readonly clock: FunnelClock
  readonly deps?: FlumeRuntimeDeps
  readonly onError?: FlumeErrorHandler
  readonly signal?: AbortSignal
}

/** Run source manifests through the same lifecycle as connector definitions. */
export class FunnelChannelSupervisor {
  private readonly channels = new Map<string, Channel>()
  private readonly registry: FunnelListenerRegistry
  private readonly logger: FunnelLogger
  private started = false
  private closed = false

  constructor(private readonly props: Props) {
    this.logger = new ObservedFunnelLogger(props.logger, () => {})
    this.registry = new FunnelListenerRegistry({
      logger: this.logger,
      channels: {
        listAllConnectors: () =>
          [...this.channels.keys()].map((id) => ({
            id,
            name: id,
            type: "channel",
            channelId: id,
            channelName: id,
          })),
        createListener: (id) => {
          const channel = this.channels.get(id)
          return channel === undefined
            ? null
            : {
                channelId: id,
                config: { id, name: id, type: "channel" },
                listener: new FunnelChannelListener({ ...props, logger: this.logger, channel }),
              }
        },
      },
      notify: async (_channel, _connector, content, meta) => {
        props.broadcaster.broadcast(content, meta)
      },
    })
    props.signal?.addEventListener(
      "abort",
      () => {
        void this.stop().catch((error: unknown) => {
          this.logger.error("channel shutdown failed", { error: String(error) })
        })
      },
      { once: true },
    )
  }

  register(channel: Channel): void {
    if (this.closed || this.props.signal?.aborted) return
    if (this.has(channel.id)) {
      throw new Error(`FunnelChannelSupervisor: channel id already registered: ${channel.id}`)
    }
    this.channels.set(channel.id, channel)
    if (this.started) void this.startChannel(channel)
  }

  async unregister(id: string): Promise<void> {
    // Keep the name reserved until stop completes, so a new registration cannot
    // lose its start to the old instance's pending stop.
    await this.registry.stop(id, id)
    this.channels.delete(id)
  }

  async start(): Promise<void> {
    if (this.closed || this.started || this.props.signal?.aborted) return
    this.started = true
    await Promise.all([...this.channels.values()].map((channel) => this.startChannel(channel)))
  }

  async stop(): Promise<void> {
    this.closed = true
    this.started = false
    this.channels.clear()
    await this.registry.stopAll()
  }

  ids(): ReadonlyArray<string> {
    return this.registry.list().map((entry) => entry.channelId)
  }

  has(id: string): boolean {
    return this.channels.has(id)
  }

  private async startChannel(channel: Channel): Promise<void> {
    try {
      const result = await this.registry.start(channel.id, channel.id)
      if (result.ok) return
      this.logger.error(`channel "${channel.id}" failed to start`, { error: result.reason })
    } catch (error) {
      this.logger.error(`channel "${channel.id}" failed to start`, { error: String(error) })
    }
    if (this.channels.get(channel.id) === channel) this.channels.delete(channel.id)
  }
}
