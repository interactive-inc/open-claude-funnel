import { factory } from "@/factory"
import { connectorsAddHandler } from "@/routes/connectors/add"
import { connectorsGroupHandler } from "@/routes/connectors/group"
import { connectorsRemoveHandler } from "@/routes/connectors/remove"
import { connectorsRenameHandler } from "@/routes/connectors/rename"
import { connectorsSetHandler } from "@/routes/connectors/set"
import { connectorsShowHandler } from "@/routes/connectors/show"

export const connectorsRoutes = factory
  .createApp()
  .get("/", ...connectorsGroupHandler)
  .put("/:name/rename/:newName", ...connectorsRenameHandler)
  .put("/rename/:name/:newName", ...connectorsRenameHandler)
  .post("/:name", ...connectorsAddHandler)
  .put("/:name", ...connectorsSetHandler)
  .delete("/:name", ...connectorsRemoveHandler)
  .get("/:name", ...connectorsShowHandler)
