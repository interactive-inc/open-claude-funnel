import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

const showHelp = `funnel channels <name> — show channel details`

export const channelsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({}), showHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel
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
