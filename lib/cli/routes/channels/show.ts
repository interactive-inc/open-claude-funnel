import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/channels/show.help";

export const channelsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param");
    const funnel = c.var.funnel;
    const channel = funnel.channels.get(param.name);

    if (!channel) {
      throw new HTTPException(404, { message: `channel "${param.name}" not found` });
    }

    const lines = [
      `name: ${channel.name}`,
      `connectors: ${channel.connectors.length > 0 ? channel.connectors.join(", ") : "(none)"}`,
      `delivery: ${channel.delivery}`,
    ];

    return c.text(lines.join("\n"));
  },
);
