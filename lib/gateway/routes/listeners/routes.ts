import { factory } from "@/gateway/factory"
import { listenersListHandler } from "@/gateway/routes/listeners/list-route"
import { listenersRestartHandler } from "@/gateway/routes/listeners/restart-route"
import { listenersStartHandler } from "@/gateway/routes/listeners/start-route"
import { listenersStopHandler } from "@/gateway/routes/listeners/stop-route"

export const listenersRoutes = factory
  .createApp()
  .get("/listeners", ...listenersListHandler)
  .post("/listeners/:channel/:connector/start", ...listenersStartHandler)
  .delete("/listeners/:channel/:connector", ...listenersStopHandler)
  .post("/listeners/:channel/:connector/restart", ...listenersRestartHandler)
