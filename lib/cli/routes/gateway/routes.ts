import { factory } from "@/cli/factory";
import { gatewayGroupHandler } from "@/cli/routes/gateway/group";
import { gatewayListenersHandler } from "@/cli/routes/gateway/listeners";
import { gatewayLogsHandler } from "@/cli/routes/gateway/logs";
import { gatewayRestartHandler } from "@/cli/routes/gateway/restart";
import { gatewayRunHandler } from "@/cli/routes/gateway/run";
import { gatewayStartHandler } from "@/cli/routes/gateway/start";
import { gatewayStatusHandler } from "@/cli/routes/gateway/status";
import { gatewayStopHandler } from "@/cli/routes/gateway/stop";

export const gatewayRoutes = factory
  .createApp()
  .get("/", ...gatewayGroupHandler)
  .get("/status", ...gatewayStatusHandler)
  .get("/start", ...gatewayStartHandler)
  .get("/stop", ...gatewayStopHandler)
  .get("/restart", ...gatewayRestartHandler)
  .get("/run", ...gatewayRunHandler)
  .get("/logs", ...gatewayLogsHandler)
  .get("/listeners", ...gatewayListenersHandler);
