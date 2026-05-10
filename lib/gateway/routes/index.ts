import { factory } from "@/gateway/factory"
import { healthHandler } from "@/gateway/routes/health-route"
import { listenersListHandler } from "@/gateway/routes/listeners-list-route"
import { listenersRestartHandler } from "@/gateway/routes/listeners-restart-route"
import { listenersStartHandler } from "@/gateway/routes/listeners-start-route"
import { listenersStopHandler } from "@/gateway/routes/listeners-stop-route"
import { statusHandler } from "@/gateway/routes/status-route"

/**
 * Top-level Hono app for the gateway daemon. Mounts every HTTP route flat
 * (the WebSocket /ws upgrade is handled directly by `Bun.serve`). Deps come
 * from the `deps` variable set by `FunnelGatewayServer`'s middleware — same
 * shape as CLI's `c.var.funnel`.
 */
export const gatewayRoutes = factory
  .createApp()
  .get("/health", ...healthHandler)
  .get("/status", ...statusHandler)
  .get("/listeners", ...listenersListHandler)
  .post("/listeners/:channel/:connector/start", ...listenersStartHandler)
  .delete("/listeners/:channel/:connector", ...listenersStopHandler)
  .post("/listeners/:channel/:connector/restart", ...listenersRestartHandler)
