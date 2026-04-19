import { factory } from "@/factory"
import { agentsAddHandler } from "@/routes/agents/add"
import { agentsGroupHandler } from "@/routes/agents/group"
import { agentsLaunchHandler } from "@/routes/agents/launch"
import { agentsRemoveHandler } from "@/routes/agents/remove"
import { agentsRenameHandler } from "@/routes/agents/rename"
import { agentsSetHandler } from "@/routes/agents/set"

export const agentsRoutes = factory
  .createApp()
  .get("/", ...agentsGroupHandler)
  .put("/:name/rename/:newName", ...agentsRenameHandler)
  .put("/rename/:name/:newName", ...agentsRenameHandler)
  .post("/:name", ...agentsAddHandler)
  .put("/:name", ...agentsSetHandler)
  .delete("/:name", ...agentsRemoveHandler)
  .get("/:name", ...agentsLaunchHandler)
