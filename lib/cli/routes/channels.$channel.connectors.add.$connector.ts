import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

const slackBody = z.object({
  type: z.literal("slack"),
  "bot-token": z.string().startsWith("xoxb-"),
  "app-token": z.string().startsWith("xapp-"),
})

const ghBody = z.object({
  type: z.literal("gh"),
  "poll-interval": z.coerce.number().int().positive().optional(),
})

const discordBody = z.object({
  type: z.literal("discord"),
  "bot-token": z.string().min(10),
})

const scheduleBody = z.object({
  type: z.literal("schedule"),
})

const addBody = z.discriminatedUnion("type", [slackBody, ghBody, discordBody, scheduleBody])

export const channelsConnectorsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", addBody),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    if (query.type === "slack") {
      const created = funnel.channels.addConnector(param.channel, {
        type: "slack",
        name: param.connector,
        botToken: query["bot-token"],
        appToken: query["app-token"],
      })

      await funnel.listeners.start(param.channel, created.name)

      return c.text(`added slack connector "${created.name}" to channel "${param.channel}"`)
    }

    if (query.type === "gh") {
      const created = funnel.channels.addConnector(param.channel, {
        type: "gh",
        name: param.connector,
        ...(query["poll-interval"] !== undefined ? { pollInterval: query["poll-interval"] } : {}),
      })

      await funnel.listeners.start(param.channel, created.name)

      return c.text(`added gh connector "${created.name}" to channel "${param.channel}"`)
    }

    if (query.type === "discord") {
      const created = funnel.channels.addConnector(param.channel, {
        type: "discord",
        name: param.connector,
        botToken: query["bot-token"],
      })

      await funnel.listeners.start(param.channel, created.name)

      return c.text(`added discord connector "${created.name}" to channel "${param.channel}"`)
    }

    const created = funnel.channels.addConnector(param.channel, {
      type: "schedule",
      name: param.connector,
      entries: [],
    })

    await funnel.listeners.start(param.channel, created.name)

    return c.text(`added schedule connector "${created.name}" to channel "${param.channel}"`)
  },
)
