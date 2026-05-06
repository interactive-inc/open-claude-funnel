import { factory } from "@/cli/factory";
import { connectorsAddHandler } from "@/cli/routes/connectors/add";
import { connectorsGroupHandler } from "@/cli/routes/connectors/group";
import { connectorsRemoveHandler } from "@/cli/routes/connectors/remove";
import { connectorsRenameHandler } from "@/cli/routes/connectors/rename";
import { connectorsSchedulesAddHandler } from "@/cli/routes/connectors/schedules-add";
import { connectorsSchedulesGroupHandler } from "@/cli/routes/connectors/schedules-group";
import { connectorsSchedulesRemoveHandler } from "@/cli/routes/connectors/schedules-remove";
import { connectorsSetHandler } from "@/cli/routes/connectors/set";
import { connectorsShowHandler } from "@/cli/routes/connectors/show";

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
  .get("/:name", ...connectorsShowHandler);
