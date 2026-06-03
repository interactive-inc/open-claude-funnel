// Gateway sub-entry: in-process gateway building blocks.
// Use these when embedding funnel inside your own process rather than
// spawning a daemon. The Funnel facade's gatewayServer() method wires
// these together automatically — import directly only when you need
// fine-grained control over the gateway internals.
export * from "@/gateway/gateway-server"
export * from "@/gateway/broadcaster"
export * from "@/gateway/listener-supervisor"
export * from "@/gateway/gateway-token"
export * from "@/gateway/channel-publisher"
export * from "@/gateway/funnel-event-log"
export * from "@/gateway/sqlite-funnel-event-log"
export * from "@/gateway/memory-funnel-event-log"
export * from "@/gateway/connector-diagnostic-log"
export * from "@/gateway/sqlite-connector-diagnostic-log"
export * from "@/gateway/memory-connector-diagnostic-log"
export * from "@/gateway/publish-schema"
export type { GatewayApp } from "@/gateway/routes"
export type { GatewayEmitInput, GatewayRouteDeps } from "@/gateway/routes/route-deps"
export { type Env as GatewayServerEnv } from "@/gateway/factory"
