import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/connectors/group.help";

export const connectorsGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => {
    const funnel = c.var.funnel;
    const connectors = funnel.connectors.list();

    if (connectors.length === 0) return c.text("no connectors");

    const lines = connectors.map((con) => `${con.name} (${con.type})`);

    return c.text(lines.join("\n"));
  },
);
