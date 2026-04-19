import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/channels/connectors-attach.help"

export const channelsConnectorsAttachHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string(), connector: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.channels.attachConnector(param.name, param.connector)

    return c.text(`attached connector "${param.connector}" to channel "${param.name}"`)
  },
)
