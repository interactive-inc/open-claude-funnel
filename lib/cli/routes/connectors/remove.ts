import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/connectors/remove.help";

export const connectorsRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}), help),
  async (c) => {
    const param = c.req.valid("param");
    const funnel = c.var.funnel;

    const stop = await funnel.listeners.stop(param.name);

    funnel.connectors.remove(param.name);

    const note = stop.state === "ok" ? " (listener stopped)" : "";

    return c.text(`removed connector "${param.name}"${note}`);
  },
);
