import type { FunnelBroadcaster } from "@/gateway/broadcaster"
import type { FunnelListenerSupervisor } from "@/gateway/listener-supervisor"

export type GatewayRouteDeps = {
  selfPid: number
  broadcaster: FunnelBroadcaster
  supervisor: FunnelListenerSupervisor
  uptimeMs: () => number
}
