import { z } from "zod"
import { factory } from "@/cli/factory"
import { connectorFieldsSchema } from "@/cli/connector-fields"
import { zValidator } from "@/cli/router/validator"

export const channelsConnectorsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", z.intersection(connectorFieldsSchema, z.object({ type: z.string().min(1) }))),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const created = funnel.channels.addConnector(param.channel, {
      ...query,
      type: query.type,
      name: param.connector,
    })
    await funnel.listeners.start(param.channel, created.name)
    return c.text(`added ${created.type} connector "${created.name}" to channel "${param.channel}"`)
  },
)
