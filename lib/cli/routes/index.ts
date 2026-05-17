import { HTTPException } from "hono/http-exception"
import { factory } from "@/cli/factory"
import {
  addHelp as channelsAddHelp,
  channelsAddHandler,
} from "@/cli/routes/channels.add.$channel"
import { channelsConnectorsGroupHandler } from "@/cli/routes/channels.$channel.connectors"
import {
  addHelp as channelsConnectorsAddHelp,
  channelsConnectorsAddHandler,
} from "@/cli/routes/channels.$channel.connectors.add.$connector"
import {
  channelsConnectorsRemoveHandler,
  removeHelp as channelsConnectorsRemoveHelp,
} from "@/cli/routes/channels.$channel.connectors.remove.$connector"
import {
  channelsConnectorsSetHandler,
  setHelp as channelsConnectorsSetHelp,
} from "@/cli/routes/channels.$channel.connectors.set.$connector"
import { channelsConnectorsShowHandler } from "@/cli/routes/channels.$channel.connectors.$connector"
import {
  channelsConnectorsRenameHandler,
  renameHelp as channelsConnectorsRenameHelp,
} from "@/cli/routes/channels.$channel.connectors.$connector.rename.$newName"
import { channelsConnectorsRequestHandler } from "@/cli/routes/channels.$channel.connectors.$connector.request"
import { channelsConnectorsSchedulesGroupHandler } from "@/cli/routes/channels.$channel.connectors.$connector.schedules"
import {
  addHelp as channelsConnectorsSchedulesAddHelp,
  channelsConnectorsSchedulesAddHandler,
} from "@/cli/routes/channels.$channel.connectors.$connector.schedules.add.$id"
import {
  channelsConnectorsSchedulesRemoveHandler,
  removeHelp as channelsConnectorsSchedulesRemoveHelp,
} from "@/cli/routes/channels.$channel.connectors.$connector.schedules.remove.$id"
import {
  channelsRemoveHandler,
  removeHelp as channelsRemoveHelp,
} from "@/cli/routes/channels.remove.$channel"
import {
  channelsRenameHandler,
  renameHelp as channelsRenameHelp,
} from "@/cli/routes/channels.$channel.rename.$newName"
import { channelsSetDeliveryHandler } from "@/cli/routes/channels.$channel.set.delivery.$mode"
import { channelsShowHandler } from "@/cli/routes/channels.$channel"
import { channelsGroupHandler } from "@/cli/routes/channels"
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
} from "@/cli/routes/profiles.add.$profile"
import { profilesAsDefaultHandler } from "@/cli/routes/profiles.$profile.as-default"
import {
  profilesRenameHandler,
  renameHelp as profilesRenameHelp,
} from "@/cli/routes/profiles.$profile.rename.$newName"
import { profilesLaunchHandler } from "@/cli/routes/profiles.$profile.run"
import {
  profilesRemoveHandler,
  removeHelp as profilesRemoveHelp,
} from "@/cli/routes/profiles.remove.$profile"
import {
  profilesSetHandler,
  setHelp as profilesSetHelp,
} from "@/cli/routes/profiles.set.$profile"
import { profilesGroupHandler } from "@/cli/routes/profiles"
import { statusHandler } from "@/cli/routes/status"
import { updateHandler } from "@/cli/routes/update"
import { Funnel } from "@/funnel"

const helpRoute = (text: string) => factory.createHandlers((c) => c.text(text))

/**
 * Build the CLI Hono app wired to a specific Funnel instance.
 * Exposed so library consumers can mount the same routes their `fnl` CLI
 * uses against a custom Funnel (e.g. one with sandboxed boundaries).
 *
 * All CLI verbs (`add` / `remove` / `set` / `rename` / `as-default` / `request`) map to POST in
 * to-request.ts and stay in the URL as a literal segment. Read paths (list / show / launch) keep GET.
 * Help shortcuts at parameterless URLs return the help text directly so `funnel <verb>` (no args) is
 * informative instead of 404.
 */
export const createCliApp = (funnel: Funnel) => {
  const base = factory.createApp()

  base.use((c, next) => {
    c.set("funnel", funnel)

    return next()
  })

  base.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.text(`error: ${error.message}`, error.status)
    }

    return c.text(`error: ${error instanceof Error ? error.message : String(error)}`, 400)
  })

  return base
    .get("/claude", ...claudeHandler)
  .get("/channels", ...channelsGroupHandler)
  .post("/channels/add", ...helpRoute(channelsAddHelp))
  .post("/channels/add/:channel", ...channelsAddHandler)
  .post("/channels/remove", ...helpRoute(channelsRemoveHelp))
  .post("/channels/remove/:channel", ...channelsRemoveHandler)
  .post("/channels/rename/:channel/:newName", ...channelsRenameHandler)
  .post("/channels/:channel/rename/:newName", ...channelsRenameHandler)
  .post("/channels/rename", ...helpRoute(channelsRenameHelp))
  .post("/channels/:channel/rename", ...helpRoute(channelsRenameHelp))
  .post("/channels/:channel/set/delivery/:mode", ...channelsSetDeliveryHandler)
  .get("/channels/:channel", ...channelsShowHandler)
  .get("/channels/:channel/connectors", ...channelsConnectorsGroupHandler)
  .post(
    "/channels/:channel/connectors/add",
    ...helpRoute(channelsConnectorsAddHelp),
  )
  .post(
    "/channels/:channel/connectors/add/:connector",
    ...channelsConnectorsAddHandler,
  )
  .post(
    "/channels/:channel/connectors/remove",
    ...helpRoute(channelsConnectorsRemoveHelp),
  )
  .post(
    "/channels/:channel/connectors/remove/:connector",
    ...channelsConnectorsRemoveHandler,
  )
  .post(
    "/channels/:channel/connectors/set",
    ...helpRoute(channelsConnectorsSetHelp),
  )
  .post(
    "/channels/:channel/connectors/set/:connector",
    ...channelsConnectorsSetHandler,
  )
  .post(
    "/channels/:channel/connectors/rename/:connector/:newName",
    ...channelsConnectorsRenameHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/rename/:newName",
    ...channelsConnectorsRenameHandler,
  )
  .post(
    "/channels/:channel/connectors/rename",
    ...helpRoute(channelsConnectorsRenameHelp),
  )
  .post(
    "/channels/:channel/connectors/:connector/rename",
    ...helpRoute(channelsConnectorsRenameHelp),
  )
  .post(
    "/channels/:channel/connectors/:connector/request",
    ...channelsConnectorsRequestHandler,
  )
  .get("/channels/:channel/connectors/:connector", ...channelsConnectorsShowHandler)
  .get(
    "/channels/:channel/connectors/:connector/schedules",
    ...channelsConnectorsSchedulesGroupHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/add",
    ...helpRoute(channelsConnectorsSchedulesAddHelp),
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/add/:id",
    ...channelsConnectorsSchedulesAddHandler,
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/remove",
    ...helpRoute(channelsConnectorsSchedulesRemoveHelp),
  )
  .post(
    "/channels/:channel/connectors/:connector/schedules/remove/:id",
    ...channelsConnectorsSchedulesRemoveHandler,
  )
  .get("/profiles", ...profilesGroupHandler)
  .post("/profiles/add", ...helpRoute(profilesAddHelp))
  .post("/profiles/add/:profile", ...profilesAddHandler)
  .post("/profiles/set", ...helpRoute(profilesSetHelp))
  .post("/profiles/set/:profile", ...profilesSetHandler)
  .post("/profiles/remove", ...helpRoute(profilesRemoveHelp))
  .post("/profiles/remove/:profile", ...profilesRemoveHandler)
  .post("/profiles/rename/:profile/:newName", ...profilesRenameHandler)
  .post("/profiles/:profile/rename/:newName", ...profilesRenameHandler)
  .post("/profiles/rename", ...helpRoute(profilesRenameHelp))
  .post("/profiles/:profile/rename", ...helpRoute(profilesRenameHelp))
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
  .get("/gateway/listeners", ...gatewayListenersHandler)
  .get("/status", ...statusHandler)
  .get("/update", ...updateHandler)
}

/** CLI Hono app wired to a default `new Funnel()`. For embedding with a custom Funnel use `createCliApp`. */
export const app = createCliApp(new Funnel())
