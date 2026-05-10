import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { channelDeliveryModeSchema } from "@/engine/settings/settings-schema"

export const addHelp = `funnel channels add — add a channel

usage: funnel channels add <name> [--delivery fanout|exclusive]

options:
  --delivery    routing mode (default fanout):
                  fanout      every connected client receives every event
                  exclusive   each event delivered to exactly one client (round-robin)`

export const channelsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator(
    "query",
    z.object({
      delivery: channelDeliveryModeSchema.optional(),
    }),
    addHelp,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const created = funnel.channels.add({ name: param.channel, delivery: query.delivery })

    return c.text(`added channel "${created.name}" (id: ${created.id})`)
  },
)
