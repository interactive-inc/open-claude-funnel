import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/channels/set-delivery.help";
import { channelDeliveryModeSchema } from "@/engine/settings/settings-schema";

export const channelsSetDeliveryHandler = factory.createHandlers(
  zValidator(
    "param",
    z.object({
      name: z.string(),
      mode: channelDeliveryModeSchema,
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param");
    const funnel = c.var.funnel;

    funnel.channels.setDelivery(param.name, param.mode);

    return c.text(`channel "${param.name}" delivery set to ${param.mode}`);
  },
);
