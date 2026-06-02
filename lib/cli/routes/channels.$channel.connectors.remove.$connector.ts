import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const channelsConnectorsRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", z.object({})),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    await funnel.listeners.stop(param.channel, param.connector)

    funnel.channels.removeConnector(param.channel, param.connector)

    return c.text(`removed connector "${param.connector}" from channel "${param.channel}"`)
  },
)
