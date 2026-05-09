import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/connectors/group.help"

export const channelsConnectorsGroupHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const channel = funnel.channels.get(param.channel)

    if (!channel) return c.text(`channel "${param.channel}" not found`, 404)
    if (channel.connectors.length === 0) return c.text(`no connectors in channel "${channel.name}"`)

    return c.text(channel.connectors.map((c) => `${c.name} (${c.type}, id: ${c.id})`).join("\n"))
  },
)
