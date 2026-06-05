import { HTTPException } from "hono/http-exception"
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
  // Without this, a plain Error thrown by a service (e.g. channels.call() on an
  // unknown connector) falls through to Hono's default 500 "Internal Server
  // Error", hiding the real reason from the MCP caller. HTTPException already
  // carries its own status/body, so delegate to its native response untouched.
  .onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()

    const message = error instanceof Error ? error.message : String(error)

    return c.json({ error: message }, 500)
  })
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
