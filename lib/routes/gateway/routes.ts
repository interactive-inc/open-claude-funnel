import { factory } from "@/factory"
import { gatewayGroupHandler } from "@/routes/gateway/group"
import { gatewayLogsHandler } from "@/routes/gateway/logs"
import { gatewayRestartHandler } from "@/routes/gateway/restart"
import { gatewayRunHandler } from "@/routes/gateway/run"
import { gatewayStartHandler } from "@/routes/gateway/start"
import { gatewayStatusHandler } from "@/routes/gateway/status"
import { gatewayStopHandler } from "@/routes/gateway/stop"

export const gatewayRoutes = factory
  .createApp()
  .get("/", ...gatewayGroupHandler)
  .get("/status", ...gatewayStatusHandler)
  .get("/start", ...gatewayStartHandler)
  .get("/stop", ...gatewayStopHandler)
  .get("/restart", ...gatewayRestartHandler)
  .get("/run", ...gatewayRunHandler)
  .get("/logs", ...gatewayLogsHandler)
