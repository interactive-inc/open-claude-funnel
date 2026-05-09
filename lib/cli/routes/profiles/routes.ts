import { factory } from "@/cli/factory"
import { profilesAddHandler } from "@/cli/routes/profiles/add"
import { profilesAsDefaultHandler } from "@/cli/routes/profiles/as-default"
import { profilesGroupHandler } from "@/cli/routes/profiles/group"
import { profilesLaunchHandler } from "@/cli/routes/profiles/launch"
import { profilesRemoveHandler } from "@/cli/routes/profiles/remove"
import { profilesRenameHandler } from "@/cli/routes/profiles/rename"
import { profilesSetHandler } from "@/cli/routes/profiles/set"

export const profilesRoutes = factory
  .createApp()
  .get("/", ...profilesGroupHandler)
  .put("/:name/rename/:newName", ...profilesRenameHandler)
  .put("/rename/:name/:newName", ...profilesRenameHandler)
  .put("/:name/as-default", ...profilesAsDefaultHandler)
  .post("/:name", ...profilesAddHandler)
  .put("/:name", ...profilesSetHandler)
  .delete("/:name", ...profilesRemoveHandler)
  .get("/:name/run", ...profilesLaunchHandler)
  .get("/:name", ...profilesLaunchHandler)
