import { factory } from "@/factory"
import { profilesAddHandler } from "@/routes/profiles/add"
import { profilesGroupHandler } from "@/routes/profiles/group"
import { profilesLaunchHandler } from "@/routes/profiles/launch"
import { profilesRemoveHandler } from "@/routes/profiles/remove"
import { profilesRenameHandler } from "@/routes/profiles/rename"
import { profilesSetHandler } from "@/routes/profiles/set"

export const profilesRoutes = factory
  .createApp()
  .get("/", ...profilesGroupHandler)
  .put("/:name/rename/:newName", ...profilesRenameHandler)
  .put("/rename/:name/:newName", ...profilesRenameHandler)
  .post("/:name", ...profilesAddHandler)
  .put("/:name", ...profilesSetHandler)
  .delete("/:name", ...profilesRemoveHandler)
  .get("/:name/run", ...profilesLaunchHandler)
  .get("/:name", ...profilesLaunchHandler)
