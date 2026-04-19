import { factory } from "@/factory"
import { reposAddHandler } from "@/routes/repos/add"
import { reposGroupHandler } from "@/routes/repos/group"
import { reposRemoveHandler } from "@/routes/repos/remove"
import { reposRenameHandler } from "@/routes/repos/rename"
import { reposSetHandler } from "@/routes/repos/set"
import { reposShowHandler } from "@/routes/repos/show"

export const reposRoutes = factory
  .createApp()
  .get("/", ...reposGroupHandler)
  .put("/:name/rename/:newName", ...reposRenameHandler)
  .put("/rename/:name/:newName", ...reposRenameHandler)
  .post("/:name", ...reposAddHandler)
  .put("/:name", ...reposSetHandler)
  .delete("/:name", ...reposRemoveHandler)
  .get("/:name", ...reposShowHandler)
