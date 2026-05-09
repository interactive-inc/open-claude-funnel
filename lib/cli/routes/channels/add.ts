import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/add.help"
import { channelDeliveryModeSchema } from "@/engine/settings/settings-schema"

export const channelsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      delivery: channelDeliveryModeSchema.optional(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const channel = funnel.channels.add({ name: param.name, delivery: query.delivery })

    return c.text(`added channel "${channel.name}" (id: ${channel.id})`)
  },
)
