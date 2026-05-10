import { HTTPException } from "hono/http-exception"
import { factory } from "@/cli/factory"
import {
  addHelp as channelsAddHelp,
  channelsAddHandler,
  channelsRemoveHandler,
  channelsShowHandler,
  removeHelp as channelsRemoveHelp,
} from "@/cli/routes/channels.$channel"
import { channelsConnectorsGroupHandler } from "@/cli/routes/channels.$channel.connectors"
import {
  addHelp as channelsConnectorsAddHelp,
  channelsConnectorsAddHandler,
  channelsConnectorsRemoveHandler,
  channelsConnectorsSetHandler,
  channelsConnectorsShowHandler,
  removeHelp as channelsConnectorsRemoveHelp,
  setHelp as channelsConnectorsSetHelp,
} from "@/cli/routes/channels.$channel.connectors.$connector"
import {
  channelsConnectorsRenameHandler,
  renameHelp as channelsConnectorsRenameHelp,
} from "@/cli/routes/channels.$channel.connectors.$connector.rename.$newName"
import { channelsConnectorsRequestHandler } from "@/cli/routes/channels.$channel.connectors.$connector.request"
import { channelsConnectorsSchedulesGroupHandler } from "@/cli/routes/channels.$channel.connectors.$connector.schedules"
import {
  addHelp as channelsConnectorsSchedulesAddHelp,
  channelsConnectorsSchedulesAddHandler,
  channelsConnectorsSchedulesRemoveHandler,
  removeHelp as channelsConnectorsSchedulesRemoveHelp,
} from "@/cli/routes/channels.$channel.connectors.$connector.schedules.$id"
import {
  channelsRenameHandler,
  renameHelp as channelsRenameHelp,
} from "@/cli/routes/channels.$channel.rename.$newName"
import { channelsSetDeliveryHandler } from "@/cli/routes/channels.$channel.set.delivery.$mode"
import {
  channelsGroupHandler,
  groupHelp as channelsGroupHelp,
} from "@/cli/routes/channels"
import { claudeHandler } from "@/cli/routes/claude"
import { gatewayGroupHandler } from "@/cli/routes/gateway"
import { gatewayListenersHandler } from "@/cli/routes/gateway.listeners"
import { gatewayLogsHandler } from "@/cli/routes/gateway.logs"
import { gatewayRestartHandler } from "@/cli/routes/gateway.restart"
import { gatewayRunHandler } from "@/cli/routes/gateway.run"
import { gatewayStartHandler } from "@/cli/routes/gateway.start"
import { gatewayStatusHandler } from "@/cli/routes/gateway.status"
import { gatewayStopHandler } from "@/cli/routes/gateway.stop"
import {
  addHelp as profilesAddHelp,
  profilesAddHandler,
  profilesRemoveHandler,
  profilesSetHandler,
  removeHelp as profilesRemoveHelp,
  setHelp as profilesSetHelp,
} from "@/cli/routes/profiles.$profile"
import { profilesAsDefaultHandler } from "@/cli/routes/profiles.$profile.as-default"
import {
  profilesRenameHandler,
  renameHelp as profilesRenameHelp,
} from "@/cli/routes/profiles.$profile.rename.$newName"
import { profilesLaunchHandler } from "@/cli/routes/profiles.$profile.run"
import {
  groupHelp as profilesGroupHelp,
  profilesGroupHandler,
} from "@/cli/routes/profiles"
import { statusHandler } from "@/cli/routes/status"
import { updateHandler } from "@/cli/routes/update"
import { Funnel } from "@/funnel"

const base = factory.createApp()

base.use((c, next) => {
  c.set("funnel", new Funnel())

  return next()
})

base.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.text(`error: ${error.message}`, error.status)
  }

  return c.text(`error: ${error instanceof Error ? error.message : String(error)}`, 400)
})

const helpRoute = (text: string) => factory.createHandlers((c) => c.text(text))

export const app = base
  .get("/claude", ...claudeHandler)
  .get("/channels", ...channelsGroupHandler)
  .post("/channels", ...helpRoute(channelsAddHelp))
  .delete("/channels", ...helpRoute(channelsRemoveHelp))
  .put("/channels", ...helpRoute(channelsGroupHelp))
  .put("/channels/:channel/rename/:newName", ...channelsRenameHandler)
  .put("/channels/rename/:channel/:newName", ...channelsRenameHandler)
  .put("/channels/:channel/rename", ...helpRoute(channelsRenameHelp))
  .put("/channels/:channel/set/delivery/:mode", ...channelsSetDeliveryHandler)
  .post("/channels/:channel", ...channelsAddHandler)
  .delete("/channels/:channel", ...channelsRemoveHandler)
  .get("/channels/:channel", ...channelsShowHandler)
  .get("/channels/:channel/connectors", ...channelsConnectorsGroupHandler)
  .post(
    "/channels/:channel/connectors",
    ...helpRoute(channelsConnectorsAddHelp),
  )
  .delete(
    "/channels/:channel/connectors",
    ...helpRoute(channelsConnectorsRemoveHelp),
  )
  .put(
    "/channels/:channel/connectors",
    ...helpRoute(channelsConnectorsSetHelp),
  )
  .put(
    "/channels/:channel/connectors/rename/:connector/:newName",
    ...channelsConnectorsRenameHandler,
  )
  .put(
    "/channels/:channel/connectors/:connector/rename/:newName",
    ...channelsConnectorsRenameHandler,
  )
  .put(
    "/channels/:channel/connectors/:connector/rename",
    ...helpRoute(channelsConnectorsRenameHelp),
  )
  .post("/channels/:channel/connectors/:connector/request", ...channelsConnectorsRequestHandler)
  .post("/channels/:channel/connectors/:connector", ...channelsConnectorsAddHandler)
  .put("/channels/:channel/connectors/:connector", ...channelsConnectorsSetHandler)
  .delete("/channels/:channel/connectors/:connector", ...channelsConnectorsRemoveHandler)
  .get("/channels/:channel/connectors/:connector", ...channelsConnectorsShowHandler)
  .get(
    "/channels/:channel/connectors/:connector/schedules",
    ...channelsConnectorsSchedulesGroupHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules",
    ...helpRoute(channelsConnectorsSchedulesAddHelp),
  )
  .delete(
    "/channels/:channel/connectors/:connector/schedules",
    ...helpRoute(channelsConnectorsSchedulesRemoveHelp),
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/:id",
    ...channelsConnectorsSchedulesAddHandler,
  )
  .delete(
    "/channels/:channel/connectors/:connector/schedules/:id",
    ...channelsConnectorsSchedulesRemoveHandler,
  )
  .get("/profiles", ...profilesGroupHandler)
  .post("/profiles", ...helpRoute(profilesAddHelp))
  .put("/profiles", ...helpRoute(profilesSetHelp))
  .delete("/profiles", ...helpRoute(profilesRemoveHelp))
  .put("/profiles/:profile/rename/:newName", ...profilesRenameHandler)
  .put("/profiles/rename/:profile/:newName", ...profilesRenameHandler)
  .put("/profiles/:profile/rename", ...helpRoute(profilesRenameHelp))
  .put("/profiles/:profile/as-default", ...profilesAsDefaultHandler)
  .post("/profiles/:profile", ...profilesAddHandler)
  .put("/profiles/:profile", ...profilesSetHandler)
  .delete("/profiles/:profile", ...profilesRemoveHandler)
  .get("/profiles/:profile/run", ...profilesLaunchHandler)
  .get("/profiles/:profile", ...profilesLaunchHandler)
  .get("/gateway", ...gatewayGroupHandler)
  .get("/gateway/status", ...gatewayStatusHandler)
  .get("/gateway/start", ...gatewayStartHandler)
  .get("/gateway/stop", ...gatewayStopHandler)
  .get("/gateway/restart", ...gatewayRestartHandler)
  .get("/gateway/run", ...gatewayRunHandler)
  .get("/gateway/logs", ...gatewayLogsHandler)
  .get("/gateway/listeners", ...gatewayListenersHandler)
  .get("/status", ...statusHandler)
  .get("/update", ...updateHandler)
