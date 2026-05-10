import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const addHelp = `funnel channels <channel> connectors add|attach <connector> — add a connector to a channel

usage:
  funnel channels <channel> connectors attach <connector> --type=slack --bot-token=xoxb-... --app-token=xapp-...
  funnel channels <channel> connectors attach <connector> --type=gh [--poll-interval=60]
  funnel channels <channel> connectors attach <connector> --type=discord --bot-token=...
  funnel channels <channel> connectors attach <connector> --type=schedule

\`add\` and \`attach\` are synonyms; \`remove\` and \`detach\` are synonyms.
Token uniqueness is enforced across all channels.`

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

const addBody = z.discriminatedUnion("type", [slackBody, ghBody, discordBody, scheduleBody])

export const channelsConnectorsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", addBody, addHelp),
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

export const showHelp = `funnel channels <channel> connectors show <connector> — show connector config

usage: funnel channels <channel> connectors show <connector>`

export const channelsConnectorsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", z.object({}), showHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const connector = funnel.channels.getConnector(param.channel, param.connector)

    if (!connector) {
      throw new HTTPException(404, {
        message: `connector "${param.connector}" not found in channel "${param.channel}"`,
      })
    }

    return c.text(JSON.stringify(connector, null, 2))
  },
)

export const setHelp = `funnel channels <channel> connectors set <connector> — update connector fields

usage:
  funnel channels <ch> connectors set <conn> [--bot-token=...] [--app-token=...]   # slack
  funnel channels <ch> connectors set <conn> [--bot-token=...]                    # discord
  funnel channels <ch> connectors set <conn> [--poll-interval=N]                  # gh`

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
    setHelp,
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const existing = funnel.channels.getConnector(param.channel, param.connector)

    if (!existing) {
      throw new HTTPException(404, {
        message: `connector "${param.connector}" not found in channel "${param.channel}"`,
      })
    }

    if (existing.type === "slack") {
      funnel.channels.updateSlackConnector(param.channel, param.connector, {
        ...(query.botToken !== undefined ? { botToken: query.botToken } : {}),
        ...(query.appToken !== undefined ? { appToken: query.appToken } : {}),
      })
    } else if (existing.type === "discord") {
      funnel.channels.updateDiscordConnector(
        param.channel,
        param.connector,
        query.botToken !== undefined ? { botToken: query.botToken } : {},
      )
    } else if (existing.type === "gh") {
      funnel.channels.updateGhConnector(
        param.channel,
        param.connector,
        query.pollInterval !== undefined ? { pollInterval: query.pollInterval } : {},
      )
    } else {
      throw new HTTPException(400, { message: "schedule connectors have no settable fields" })
    }

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`updated connector "${param.connector}" in channel "${param.channel}"`)
  },
)

export const removeHelp = `funnel channels <channel> connectors remove|detach <connector> — remove a connector

usage: funnel channels <channel> connectors detach <connector>`

export const channelsConnectorsRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", z.object({}), removeHelp),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    await funnel.listeners.stop(param.channel, param.connector)

    funnel.channels.removeConnector(param.channel, param.connector)

    return c.text(`removed connector "${param.connector}" from channel "${param.channel}"`)
  },
)
