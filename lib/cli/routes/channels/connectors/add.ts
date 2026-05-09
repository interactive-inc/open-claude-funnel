import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/connectors/add.help"

const slackBody = z.object({
  type: z.literal("slack"),
  botToken: z.string().startsWith("xoxb-"),
  appToken: z.string().startsWith("xapp-"),
})

const ghBody = z.object({
  type: z.literal("gh"),
  pollInterval: z.coerce.number().int().positive().optional(),
})

const discordBody = z.object({
  type: z.literal("discord"),
  botToken: z.string().min(10),
})

const scheduleBody = z.object({
  type: z.literal("schedule"),
})

const body = z.discriminatedUnion("type", [slackBody, ghBody, discordBody, scheduleBody])

export const channelsConnectorsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", body, help),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    if (query.type === "slack") {
      const created = funnel.channels.addConnector(param.channel, {
        type: "slack",
        name: param.connector,
        botToken: query.botToken,
        appToken: query.appToken,
      })

      await funnel.listeners.start(param.channel, created.name)

      return c.text(`added slack connector "${created.name}" to channel "${param.channel}"`)
    }

    if (query.type === "gh") {
      const created = funnel.channels.addConnector(param.channel, {
        type: "gh",
        name: param.connector,
        ...(query.pollInterval !== undefined ? { pollInterval: query.pollInterval } : {}),
      })

      await funnel.listeners.start(param.channel, created.name)

      return c.text(`added gh connector "${created.name}" to channel "${param.channel}"`)
    }

    if (query.type === "discord") {
      const created = funnel.channels.addConnector(param.channel, {
        type: "discord",
        name: param.connector,
        botToken: query.botToken,
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
