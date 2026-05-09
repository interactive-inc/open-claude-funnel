import { factory } from "@/gateway/factory"
import { healthHandler } from "@/gateway/routes/health-route"
import { listenersRoutes } from "@/gateway/routes/listeners/routes"
import { statusHandler } from "@/gateway/routes/status-route"

/**
 * Top-level Hono app for the gateway daemon. Mounts every HTTP route
 * (the WebSocket /ws upgrade is handled directly by `Bun.serve`). Deps
 * come from the `deps` variable set by `FunnelGatewayServer`'s middleware
 * — same shape as CLI's `c.var.funnel`.
 */
export const gatewayRoutes = factory
  .createApp()
  .get("/health", ...healthHandler)
  .get("/status", ...statusHandler)
  .route("/", listenersRoutes)
