import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/connectors/set.help"

export const connectorsSetHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      "bot-token": z.string().optional(),
      "app-token": z.string().optional(),
      "poll-interval": z.string().optional(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    funnel.connectors.update(param.name, {
      botToken: query["bot-token"],
      appToken: query["app-token"],
      pollInterval: query["poll-interval"] ? Number(query["poll-interval"]) : undefined,
    })

    return c.text(`updated connector "${param.name}"`)
  },
)
