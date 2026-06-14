import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const channelsConnectorsSchedulesRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string(), id: z.string() })),
  zValidator("query", z.object({})),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    funnel.channels.connectorOp(param.channel, param.connector, "removeEntry", { id: param.id })

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`removed schedule entry "${param.id}"`)
  },
)
