import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/channels/connectors-detach.help"

export const channelsConnectorsDetachHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string(), connector: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.channels.detachConnector(param.name, param.connector)

    return c.text(`detached connector "${param.connector}" from channel "${param.name}"`)
  },
)
