import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/channels/add.help"

export const channelsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({ connector: z.string().optional() }), help),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    funnel.channels.add({
      name: param.name,
      connectors: query.connector ? [query.connector] : [],
    })

    return c.text(`added channel "${param.name}"`)
  },
)
