import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const renameHelp = `funnel channels <channel> connectors rename <connector> <new-name>

usage: funnel channels <channel> connectors rename <connector> <new-name>`

export const channelsConnectorsRenameHandler = factory.createHandlers(
  zValidator(
    "param",
    z.object({ channel: z.string(), connector: z.string(), newName: z.string() }),
  ),
  zValidator("query", z.object({}), renameHelp),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    await funnel.listeners.stop(param.channel, param.connector)

    funnel.channels.renameConnector(param.channel, param.connector, param.newName)

    await funnel.listeners.start(param.channel, param.newName)

    return c.text(`renamed connector "${param.connector}" to "${param.newName}"`)
  },
)
