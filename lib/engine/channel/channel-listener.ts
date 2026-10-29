import type { FlumeErrorHandler, FlumeRuntimeDeps } from "@interactive-inc/flume"
import type { Channel, ChannelBuildContext } from "@/engine/channel/channel"
import { FunnelFlumeSourceListener } from "@/engine/connectors/flume-source-listener"
import type { NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { requireSynchronous } from "@/require-synchronous"

type Props = Pick<ChannelBuildContext, "logger" | "clock"> & {
  channel: Channel
  deps?: FlumeRuntimeDeps
  onError?: FlumeErrorHandler
  signal?: AbortSignal
}

/** Adapts a manifest to the same source lifecycle used by built-in connectors. */
export class FunnelChannelListener extends FunnelFlumeSourceListener {
  constructor(private readonly props: Props) {
    super({
      type: "channel",
      connectorId: props.channel.id,
      channelId: props.channel.id,
      logger: props.logger,
    })
  }

  async start(notify: NotifyFn, signal?: AbortSignal): Promise<void> {
    const signals = [signal, this.props.signal].filter((value) => value !== undefined)
    const combinedSignal = AbortSignal.any(signals)
    const channel = this.props.channel
    const runtime = await channel.build({
      channelId: channel.id,
      channelName: channel.name ?? channel.id,
      signal: combinedSignal,
      logger: this.props.logger,
      clock: this.props.clock,
    })
    combinedSignal.throwIfAborted()
    await this.runStart({
      sources: runtime.sources,
      deps: this.props.deps,
      signal: combinedSignal,
      onLog: (log) => {
        if (log.level === "error") return this.props.onError?.(log)
      },
      onEvent: async (event) => {
        if (combinedSignal.aborted) return
        let payload
        try {
          const transform = runtime.transform
          const converted =
            transform === undefined
              ? { content: JSON.stringify(event.data), meta: event.meta }
              : transform.call(runtime, event)
          payload = requireSynchronous(converted, "channel transform must be synchronous")
        } catch (error) {
          this.props.logger.error(`channel "${channel.id}" transform threw`, {
            error: errorMessageOf(error),
          })
          return
        }
        if (payload !== null) await notify(payload.content, payload.meta)
      },
    })
  }
}
