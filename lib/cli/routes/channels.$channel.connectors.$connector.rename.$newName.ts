import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const channelsConnectorsRenameHandler = factory.createHandlers(
  zValidator(
    "param",
    z.object({ channel: z.string(), connector: z.string(), newName: z.string() }),
  ),
  zValidator("query", z.object({})),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    await funnel.listeners.stop(param.channel, param.connector)

    funnel.channels.renameConnector(param.channel, param.connector, param.newName)

    await funnel.listeners.start(param.channel, param.newName)

    return c.text(`renamed connector "${param.connector}" to "${param.newName}"`)
  },
)
