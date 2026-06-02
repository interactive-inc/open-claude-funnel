import { HTTPException } from "hono/http-exception"
import { factory } from "@/cli/factory"
import { channelsAddHelpHandler } from "@/cli/routes/channels.add"
import { channelsAddHandler } from "@/cli/routes/channels.add.$channel"
import { channelsConnectorsGroupHandler } from "@/cli/routes/channels.$channel.connectors"
import { channelsConnectorsAddHelpHandler } from "@/cli/routes/channels.$channel.connectors.add"
import { channelsConnectorsAddHandler } from "@/cli/routes/channels.$channel.connectors.add.$connector"
import { channelsConnectorsRemoveHelpHandler } from "@/cli/routes/channels.$channel.connectors.remove"
import { channelsConnectorsRemoveHandler } from "@/cli/routes/channels.$channel.connectors.remove.$connector"
import { channelsConnectorsSetHelpHandler } from "@/cli/routes/channels.$channel.connectors.set"
import { channelsConnectorsSetHandler } from "@/cli/routes/channels.$channel.connectors.set.$connector"
import { channelsConnectorsShowHandler } from "@/cli/routes/channels.$channel.connectors.$connector"
import { channelsConnectorsRenameHelpHandler } from "@/cli/routes/channels.$channel.connectors.rename"
import { channelsConnectorsRenameHandler } from "@/cli/routes/channels.$channel.connectors.$connector.rename.$newName"
import { channelsConnectorRenameHelpHandler } from "@/cli/routes/channels.$channel.connectors.$connector.rename"
import { channelsConnectorsRequestHandler } from "@/cli/routes/channels.$channel.connectors.$connector.request"
import { channelsConnectorsSchedulesGroupHandler } from "@/cli/routes/channels.$channel.connectors.$connector.schedules"
import { channelsConnectorSchedulesAddHelpHandler } from "@/cli/routes/channels.$channel.connectors.$connector.schedules.add"
import { channelsConnectorsSchedulesAddHandler } from "@/cli/routes/channels.$channel.connectors.$connector.schedules.add.$id"
import { channelsConnectorSchedulesRemoveHelpHandler } from "@/cli/routes/channels.$channel.connectors.$connector.schedules.remove"
import { channelsConnectorsSchedulesRemoveHandler } from "@/cli/routes/channels.$channel.connectors.$connector.schedules.remove.$id"
import { channelsPublishHelpHandler } from "@/cli/routes/channels.publish"
import { channelsPublishHandler } from "@/cli/routes/channels.$channel.publish"
import { channelsRemoveHelpHandler } from "@/cli/routes/channels.remove"
import { channelsRemoveHandler } from "@/cli/routes/channels.remove.$channel"
import { channelsRenameHelpHandler } from "@/cli/routes/channels.rename"
import { channelsChannelRenameHelpHandler } from "@/cli/routes/channels.$channel.rename"
import { channelsRenameHandler } from "@/cli/routes/channels.$channel.rename.$newName"
import { channelsSetDeliveryHandler } from "@/cli/routes/channels.$channel.set.delivery.$mode"
import { channelsShowHandler } from "@/cli/routes/channels.$channel"
import { channelsGroupHandler } from "@/cli/routes/channels"
import { channelsValidateHelpHandler } from "@/cli/routes/channels.validate"
import { channelsValidateHandler } from "@/cli/routes/channels.$channel.validate"
import { claudeHandler } from "@/cli/routes/claude"
import {
  debugHandler,
  debugEventsHandler,
  debugDroppedHandler,
  debugErrorsHandler,
  debugReplayHandler,
} from "@/cli/routes/debug"
import { gatewayGroupHandler } from "@/cli/routes/gateway"
import { gatewayListenersHandler } from "@/cli/routes/gateway.listeners"
import { gatewayLogsHandler } from "@/cli/routes/gateway.logs"
import { gatewaySqlHandler } from "@/cli/routes/gateway.sql"
import { gatewayRestartHandler } from "@/cli/routes/gateway.restart"
import { gatewayRunHandler } from "@/cli/routes/gateway.run"
import { gatewayStartHandler } from "@/cli/routes/gateway.start"
import { gatewayStatusHandler } from "@/cli/routes/gateway.status"
import { gatewayStopHandler } from "@/cli/routes/gateway.stop"
import { profilesAddHelpHandler } from "@/cli/routes/profiles.add"
import { profilesAddHandler } from "@/cli/routes/profiles.add.$profile"
import { profilesAsDefaultHandler } from "@/cli/routes/profiles.$profile.as-default"
import { profilesRenameHelpHandler } from "@/cli/routes/profiles.rename"
import { profilesProfileRenameHelpHandler } from "@/cli/routes/profiles.$profile.rename"
import { profilesRenameHandler } from "@/cli/routes/profiles.$profile.rename.$newName"
import { profilesLaunchHandler } from "@/cli/routes/profiles.$profile.run"
import { profilesRemoveHelpHandler } from "@/cli/routes/profiles.remove"
import { profilesRemoveHandler } from "@/cli/routes/profiles.remove.$profile"
import { profilesSetHelpHandler } from "@/cli/routes/profiles.set"
import { profilesSetHandler } from "@/cli/routes/profiles.set.$profile"
import { profilesGroupHandler } from "@/cli/routes/profiles"
import { schemaHandler } from "@/cli/routes/schema"
import { statusHandler } from "@/cli/routes/status"
import { updateHandler } from "@/cli/routes/update"

export const routes = factory
  .createApp()
  .onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.text(`error: ${error.message}`, error.status)
    }

    return c.text(`error: ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  .get("/claude", ...claudeHandler)
  .get("/channels", ...channelsGroupHandler)
  .post("/channels/add", ...channelsAddHelpHandler)
  .post("/channels/add/:channel", ...channelsAddHandler)
  .post("/channels/remove", ...channelsRemoveHelpHandler)
  .post("/channels/remove/:channel", ...channelsRemoveHandler)
  .post("/channels/rename/:channel/:newName", ...channelsRenameHandler)
  .post("/channels/:channel/rename/:newName", ...channelsRenameHandler)
  .post("/channels/rename", ...channelsRenameHelpHandler)
  .post("/channels/:channel/rename", ...channelsChannelRenameHelpHandler)
  .post("/channels/:channel/set/delivery/:mode", ...channelsSetDeliveryHandler)
  .post("/channels/publish", ...channelsPublishHelpHandler)
  .post("/channels/:channel/publish", ...channelsPublishHandler)
  .get("/channels/:channel/validate", ...channelsValidateHandler)
  .get("/channels/validate", ...channelsValidateHelpHandler)
  .get("/channels/:channel", ...channelsShowHandler)
  .get("/channels/:channel/connectors", ...channelsConnectorsGroupHandler)
  .post("/channels/:channel/connectors/add", ...channelsConnectorsAddHelpHandler)
  .post("/channels/:channel/connectors/add/:connector", ...channelsConnectorsAddHandler)
  .post("/channels/:channel/connectors/remove", ...channelsConnectorsRemoveHelpHandler)
  .post("/channels/:channel/connectors/remove/:connector", ...channelsConnectorsRemoveHandler)
  .post("/channels/:channel/connectors/set", ...channelsConnectorsSetHelpHandler)
  .post("/channels/:channel/connectors/set/:connector", ...channelsConnectorsSetHandler)
  .post(
    "/channels/:channel/connectors/rename/:connector/:newName",
    ...channelsConnectorsRenameHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/rename/:newName",
    ...channelsConnectorsRenameHandler,
  )
  .post("/channels/:channel/connectors/rename", ...channelsConnectorsRenameHelpHandler)
  .post(
    "/channels/:channel/connectors/:connector/rename",
    ...channelsConnectorRenameHelpHandler,
  )
  .post("/channels/:channel/connectors/:connector/request", ...channelsConnectorsRequestHandler)
  .get("/channels/:channel/connectors/:connector", ...channelsConnectorsShowHandler)
  .get(
    "/channels/:channel/connectors/:connector/schedules",
    ...channelsConnectorsSchedulesGroupHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/add",
    ...channelsConnectorSchedulesAddHelpHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/add/:id",
    ...channelsConnectorsSchedulesAddHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/remove",
    ...channelsConnectorSchedulesRemoveHelpHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/remove/:id",
    ...channelsConnectorsSchedulesRemoveHandler,
  )
  .get("/profiles", ...profilesGroupHandler)
  .post("/profiles/add", ...profilesAddHelpHandler)
  .post("/profiles/add/:profile", ...profilesAddHandler)
  .post("/profiles/set", ...profilesSetHelpHandler)
  .post("/profiles/set/:profile", ...profilesSetHandler)
  .post("/profiles/remove", ...profilesRemoveHelpHandler)
  .post("/profiles/remove/:profile", ...profilesRemoveHandler)
  .post("/profiles/rename/:profile/:newName", ...profilesRenameHandler)
  .post("/profiles/:profile/rename/:newName", ...profilesRenameHandler)
  .post("/profiles/rename", ...profilesRenameHelpHandler)
  .post("/profiles/:profile/rename", ...profilesProfileRenameHelpHandler)
  .post("/profiles/:profile/as-default", ...profilesAsDefaultHandler)
  .get("/profiles/:profile/run", ...profilesLaunchHandler)
  .get("/profiles/:profile", ...profilesLaunchHandler)
  .get("/gateway", ...gatewayGroupHandler)
  .get("/gateway/status", ...gatewayStatusHandler)
  .get("/gateway/start", ...gatewayStartHandler)
  .get("/gateway/stop", ...gatewayStopHandler)
  .get("/gateway/restart", ...gatewayRestartHandler)
  .get("/gateway/run", ...gatewayRunHandler)
  .get("/gateway/logs", ...gatewayLogsHandler)
  .get("/gateway/sql", ...gatewaySqlHandler)
  .get("/gateway/listeners", ...gatewayListenersHandler)
  .get("/debug", ...debugHandler)
  .get("/debug/events", ...debugEventsHandler)
  .get("/debug/dropped", ...debugDroppedHandler)
  .get("/debug/errors", ...debugErrorsHandler)
  .get("/debug/replay", ...debugReplayHandler)
  .get("/schema", ...schemaHandler)
  .get("/status", ...statusHandler)
  .get("/update", ...updateHandler)

export type CliApp = typeof routes
