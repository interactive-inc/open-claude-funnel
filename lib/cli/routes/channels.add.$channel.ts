import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { channelDeliveryModeSchema } from "@/engine/settings/settings-schema"

export const channelsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator(
    "query",
    z.object({
      delivery: channelDeliveryModeSchema.optional(),
    }),
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    const created = funnel.channels.add({ name: param.channel, delivery: query.delivery })

    return c.text(`added channel "${created.name}" (id: ${created.id})`)
  },
)
