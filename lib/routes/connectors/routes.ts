import { factory } from "@/factory"
import { connectorsAddHandler } from "@/routes/connectors/add"
import { connectorsGroupHandler } from "@/routes/connectors/group"
import { connectorsRemoveHandler } from "@/routes/connectors/remove"
import { connectorsRenameHandler } from "@/routes/connectors/rename"
import { connectorsSchedulesAddHandler } from "@/routes/connectors/schedules-add"
import { connectorsSchedulesGroupHandler } from "@/routes/connectors/schedules-group"
import { connectorsSchedulesRemoveHandler } from "@/routes/connectors/schedules-remove"
import { connectorsSetHandler } from "@/routes/connectors/set"
import { connectorsShowHandler } from "@/routes/connectors/show"

export const connectorsRoutes = factory
  .createApp()
  .get("/", ...connectorsGroupHandler)
  .put("/:name/rename/:newName", ...connectorsRenameHandler)
  .put("/rename/:name/:newName", ...connectorsRenameHandler)
  .post("/:name/schedules", ...connectorsSchedulesAddHandler)
  .get("/:name/schedules", ...connectorsSchedulesGroupHandler)
  .delete("/:name/schedules/:id", ...connectorsSchedulesRemoveHandler)
  .post("/:name", ...connectorsAddHandler)
  .put("/:name", ...connectorsSetHandler)
  .delete("/:name", ...connectorsRemoveHandler)
  .get("/:name", ...connectorsShowHandler)
