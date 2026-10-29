import type { FunnelChannels } from "@/engine/channels/channels"
import type { FunnelBroadcaster } from "@/gateway/broadcaster"
import type { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"

export type GatewayEmitInput = {
  channel: string
  connector?: string
  content: string
  meta?: Record<string, string>
}

export type GatewayRouteDeps = {
  broadcaster: FunnelBroadcaster
  registry: FunnelListenerRegistry
  channels: FunnelChannels
  uptimeMs: () => number
  emit: (input: GatewayEmitInput) => { offset: number }
  assertActive: () => void
  callSignal?: AbortSignal
  diagnosticLog?: ConnectorDiagnosticLog
  onError?: OnFunnelError
}
