import { factory } from "@/cli/factory"
import { channelsAddHandler } from "@/cli/routes/channels/add"
import { channelsConnectorsRoutes } from "@/cli/routes/channels/connectors/routes"
import { channelsGroupHandler } from "@/cli/routes/channels/group"
import { channelsRemoveHandler } from "@/cli/routes/channels/remove"
import { channelsRenameHandler } from "@/cli/routes/channels/rename"
import { channelsSetDeliveryHandler } from "@/cli/routes/channels/set-delivery"
import { channelsShowHandler } from "@/cli/routes/channels/show"

export const channelsRoutes = factory
  .createApp()
  .get("/", ...channelsGroupHandler)
  .put("/:name/rename/:newName", ...channelsRenameHandler)
  .put("/rename/:name/:newName", ...channelsRenameHandler)
  .put("/:name/set/delivery/:mode", ...channelsSetDeliveryHandler)
  .post("/:name", ...channelsAddHandler)
  .delete("/:name", ...channelsRemoveHandler)
  .get("/:name", ...channelsShowHandler)
  .route("/:channel/connectors", channelsConnectorsRoutes)
