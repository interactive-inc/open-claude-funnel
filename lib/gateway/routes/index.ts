import { factory } from "@/gateway/factory"
import { channelsConnectorsCallHandler } from "@/gateway/routes/channels.connectors.call"
import { channelsPublishHandler } from "@/gateway/routes/channels.publish"
import { debugHandler } from "@/gateway/routes/debug"
import { healthHandler } from "@/gateway/routes/health"
import { listenersListHandler } from "@/gateway/routes/listeners.list"
import { listenersRestartHandler } from "@/gateway/routes/listeners.restart"
import { listenersStartHandler } from "@/gateway/routes/listeners.start"
import { listenersStopHandler } from "@/gateway/routes/listeners.stop"
import { statusHandler } from "@/gateway/routes/status"

/**
 * Top-level Hono app for the gateway daemon. Mounts every HTTP endpoint flat
 * (the WebSocket /ws upgrade is handled directly by `Bun.serve`). Deps come
 * from the `deps` variable set by `FunnelGatewayServer`'s middleware — same
 * shape as CLI's `c.var.funnel`.
 */
export type GatewayApp = ReturnType<typeof buildGatewayRoutes>

function buildGatewayRoutes() {
  return factory
  .createApp()
  .get("/health", ...healthHandler)
  .get("/status", ...statusHandler)
  .get("/debug", ...debugHandler)
  .get("/listeners", ...listenersListHandler)
  .post("/listeners/:channel/:connector/start", ...listenersStartHandler)
  .delete("/listeners/:channel/:connector", ...listenersStopHandler)
  .post("/listeners/:channel/:connector/restart", ...listenersRestartHandler)
  .post("/channels/:channel/connectors/:connector/call", ...channelsConnectorsCallHandler)
  .post("/channels/:channel/publish", ...channelsPublishHandler)

}

export const gatewayRoutes = buildGatewayRoutes()
