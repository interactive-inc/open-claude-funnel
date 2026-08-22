// Gateway sub-entry: in-process gateway building blocks.
// Use these when embedding funnel inside your own process rather than
// spawning a daemon. The Funnel facade's gatewayServer() method wires
// these together automatically — import directly only when you need
// fine-grained control over the gateway internals.
export * from "@/gateway/gateway-module"
export * from "@/gateway/gateway-server"
export * from "@/gateway/channel-ws-url"
export * from "@/engine/http/gateway-base-url"
export * from "@/gateway/broadcaster"
export * from "@/gateway/listener-registry"
export * from "@/gateway/gateway-token"
export * from "@/gateway/channel-publisher"
export * from "@/gateway/event-log/event-log"
export * from "@/gateway/event-log/sqlite-event-log"
export * from "@/gateway/event-log/memory-event-log"
export * from "@/engine/diagnostic-log/diagnostic-log"
export * from "@/engine/diagnostic-log/sqlite-diagnostic-log"
export * from "@/engine/diagnostic-log/memory-diagnostic-log"
export * from "@/gateway/publish-schema"
export type { GatewayApp } from "@/gateway/routes"
export type { GatewayEmitInput, GatewayRouteDeps } from "@/gateway/routes/route-deps"
export { type Env as GatewayServerEnv } from "@/gateway/factory"
