import { factory } from "@/cli/factory"
import { channelsConnectorsAddHandler } from "@/cli/routes/channels/connectors/add"
import { channelsConnectorsGroupHandler } from "@/cli/routes/channels/connectors/group"
import { channelsConnectorsRemoveHandler } from "@/cli/routes/channels/connectors/remove"
import { channelsConnectorsRenameHandler } from "@/cli/routes/channels/connectors/rename"
import { channelsConnectorsRequestHandler } from "@/cli/routes/channels/connectors/request"
import { channelsConnectorsSchedulesRoutes } from "@/cli/routes/channels/connectors/schedules/routes"
import { channelsConnectorsSetHandler } from "@/cli/routes/channels/connectors/set"
import { channelsConnectorsShowHandler } from "@/cli/routes/channels/connectors/show"

export const channelsConnectorsRoutes = factory
  .createApp()
  .get("/", ...channelsConnectorsGroupHandler)
  .put("/rename/:connector/:newName", ...channelsConnectorsRenameHandler)
  .put("/:connector/rename/:newName", ...channelsConnectorsRenameHandler)
  .post("/:connector/request", ...channelsConnectorsRequestHandler)
  .post("/:connector", ...channelsConnectorsAddHandler)
  .put("/:connector", ...channelsConnectorsSetHandler)
  .delete("/:connector", ...channelsConnectorsRemoveHandler)
  .get("/:connector", ...channelsConnectorsShowHandler)
  .route("/:connector/schedules", channelsConnectorsSchedulesRoutes)
