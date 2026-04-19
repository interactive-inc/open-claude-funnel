import { factory } from "@/factory"
import { channelsAddHandler } from "@/routes/channels/add"
import { channelsConnectorsAttachHandler } from "@/routes/channels/connectors-attach"
import { channelsConnectorsDetachHandler } from "@/routes/channels/connectors-detach"
import { channelsGroupHandler } from "@/routes/channels/group"
import { channelsRemoveHandler } from "@/routes/channels/remove"
import { channelsRenameHandler } from "@/routes/channels/rename"
import { channelsShowHandler } from "@/routes/channels/show"

export const channelsRoutes = factory
  .createApp()
  .get("/", ...channelsGroupHandler)
  .put("/:name/rename/:newName", ...channelsRenameHandler)
  .put("/rename/:name/:newName", ...channelsRenameHandler)
  .put("/:name/connectors/attach/:connector", ...channelsConnectorsAttachHandler)
  .delete("/:name/connectors/detach/:connector", ...channelsConnectorsDetachHandler)
  .post("/:name", ...channelsAddHandler)
  .delete("/:name", ...channelsRemoveHandler)
  .get("/:name", ...channelsShowHandler)
