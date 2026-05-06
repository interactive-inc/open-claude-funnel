import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/channels/add.help";
import { channelDeliveryModeSchema } from "@/engine/settings/settings-schema";

export const channelsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      connector: z.string().optional(),
      delivery: channelDeliveryModeSchema.optional(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param");
    const query = c.req.valid("query");
    const funnel = c.var.funnel;

    funnel.channels.add({
      name: param.name,
      connectors: query.connector ? [query.connector] : [],
      delivery: query.delivery,
    });

    return c.text(`added channel "${param.name}"`);
  },
);
