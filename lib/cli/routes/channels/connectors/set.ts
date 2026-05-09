import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/connectors/set.help"

export const channelsConnectorsSetHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator(
    "query",
    z
      .object({
        botToken: z.string().optional(),
        appToken: z.string().optional(),
        pollInterval: z.coerce.number().int().positive().optional(),
      })
      .passthrough(),
    help,
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const existing = funnel.channels.getConnector(param.channel, param.connector)

    if (!existing) {
      return c.text(
        `connector "${param.connector}" not found in channel "${param.channel}"`,
        404,
      )
    }

    if (existing.type === "slack") {
      funnel.channels.updateSlackConnector(param.channel, param.connector, {
        ...(query.botToken !== undefined ? { botToken: query.botToken } : {}),
        ...(query.appToken !== undefined ? { appToken: query.appToken } : {}),
      })
    } else if (existing.type === "discord") {
      funnel.channels.updateDiscordConnector(param.channel, param.connector, {
        ...(query.botToken !== undefined ? { botToken: query.botToken } : {}),
      })
    } else if (existing.type === "gh") {
      funnel.channels.updateGhConnector(param.channel, param.connector, {
        ...(query.pollInterval !== undefined ? { pollInterval: query.pollInterval } : {}),
      })
    } else {
      return c.text(`schedule connectors have no settable fields`, 400)
    }

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`updated connector "${param.connector}" in channel "${param.channel}"`)
  },
)
