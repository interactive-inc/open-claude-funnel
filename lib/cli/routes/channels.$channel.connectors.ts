import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const groupHelp = `funnel channels <channel> connectors — list connectors in a channel

usage: funnel channels <channel> connectors`

export const channelsConnectorsGroupHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({}), groupHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const channel = funnel.channels.get(param.channel)

    if (!channel) {
      throw new HTTPException(404, { message: `channel "${param.channel}" not found` })
    }

    if (channel.connectors.length === 0) return c.text(`no connectors in channel "${channel.name}"`)

    return c.text(channel.connectors.map((c) => `${c.name} (${c.type}, id: ${c.id})`).join("\n"))
  },
)
