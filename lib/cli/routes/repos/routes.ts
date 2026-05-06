import { factory } from "@/cli/factory";
import { reposAddHandler } from "@/cli/routes/repos/add";
import { reposGroupHandler } from "@/cli/routes/repos/group";
import { reposRemoveHandler } from "@/cli/routes/repos/remove";
import { reposRenameHandler } from "@/cli/routes/repos/rename";
import { reposSetHandler } from "@/cli/routes/repos/set";
import { reposShowHandler } from "@/cli/routes/repos/show";

export const reposRoutes = factory
  .createApp()
  .get("/", ...reposGroupHandler)
  .put("/:name/rename/:newName", ...reposRenameHandler)
  .put("/rename/:name/:newName", ...reposRenameHandler)
  .post("/:name", ...reposAddHandler)
  .put("/:name", ...reposSetHandler)
  .delete("/:name", ...reposRemoveHandler)
  .get("/:name", ...reposShowHandler);
