import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { channelDeliveryModeSchema } from "@/engine/settings/settings-schema"

export const addHelp = `funnel channels add — add a channel

usage: funnel channels add <name> [--connector <c>] [--delivery fanout|exclusive]

options:
  --connector   attach an existing connector at create time (repeat for multiple)
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

export const showHelp = `funnel channels <name> — show channel details`

export const channelsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({}), showHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const channel = funnel.channels.get(param.channel)

    if (!channel) {
      throw new HTTPException(404, { message: `channel "${param.channel}" not found` })
    }

    const connectorLines = channel.connectors.length
      ? channel.connectors.map((c) => `  - ${c.name} (${c.type}, id: ${c.id})`)
      : ["  (none)"]

    const lines = [
      `id: ${channel.id}`,
      `name: ${channel.name}`,
      `delivery: ${channel.delivery}`,
      `connectors:`,
      ...connectorLines,
    ]

    return c.text(lines.join("\n"))
  },
)

export const removeHelp = `funnel channels remove — remove a channel

usage: funnel channels remove <name>`

export const channelsRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({}), removeHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.channels.remove(param.channel)

    return c.text(`removed channel "${param.channel}"`)
  },
)
