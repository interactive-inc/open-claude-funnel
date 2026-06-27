import type { FunnelChannels } from "@/engine/channels/channels"
import type { FunnelBroadcaster } from "@/gateway/broadcaster"
import type { FunnelListenerRegistry } from "@/gateway/listener-registry"

export type GatewayEmitInput = {
  channel: string
  connector?: string
  content: string
  meta?: Record<string, string>
}

export type GatewayRouteDeps = {
  selfPid: number
  /** Funnel home dir this daemon is rooted at. Lets a probe tell whether the
   *  daemon answering on a shared port belongs to the expected repo/scope. */
  dir: string
  broadcaster: FunnelBroadcaster
  registry: FunnelListenerRegistry
  channels: FunnelChannels
  uptimeMs: () => number
  emit: (input: GatewayEmitInput) => { offset: number }
}
