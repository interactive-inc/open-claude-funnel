import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

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
