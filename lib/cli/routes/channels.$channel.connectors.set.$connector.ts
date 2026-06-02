import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const channelsConnectorsSetHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator(
    "query",
    z
      .object({
        "bot-token": z.string().optional(),
        "app-token": z.string().optional(),
        "poll-interval": z.coerce.number().int().positive().optional(),
      })
      .passthrough(),
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const existing = funnel.channels.getConnector(param.channel, param.connector)

    if (!existing) {
      throw new HTTPException(404, {
        message: `connector "${param.connector}" not found in channel "${param.channel}"`,
      })
    }

    if (existing.type === "slack") {
      funnel.channels.updateSlackConnector(param.channel, param.connector, {
        ...(query["bot-token"] !== undefined ? { botToken: query["bot-token"] } : {}),
        ...(query["app-token"] !== undefined ? { appToken: query["app-token"] } : {}),
      })
    } else if (existing.type === "discord") {
      funnel.channels.updateDiscordConnector(
        param.channel,
        param.connector,
        query["bot-token"] !== undefined ? { botToken: query["bot-token"] } : {},
      )
    } else if (existing.type === "gh") {
      funnel.channels.updateGhConnector(
        param.channel,
        param.connector,
        query["poll-interval"] !== undefined ? { pollInterval: query["poll-interval"] } : {},
      )
    } else {
      throw new HTTPException(400, { message: "schedule connectors have no settable fields" })
    }

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`updated connector "${param.connector}" in channel "${param.channel}"`)
  },
)
