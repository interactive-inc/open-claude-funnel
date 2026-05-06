import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/connectors/rename.help";

export const connectorsRenameHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string(), newName: z.string() })),
  zValidator("query", z.object({}), help),
  async (c) => {
    const param = c.req.valid("param");
    const funnel = c.var.funnel;

    const stop = await funnel.listeners.stop(param.name);

    funnel.connectors.rename(param.name, param["newName"]);

    if (stop.state === "ok") {
      await funnel.listeners.start(param["newName"]);
    }

    const note = stop.state === "ok" ? " (listener restarted)" : "";

    return c.text(`renamed connector "${param.name}" to "${param["newName"]}"${note}`);
  },
);
