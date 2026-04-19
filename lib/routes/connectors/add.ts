import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/connectors/add.help"

export const connectorsAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("slack"),
        "bot-token": z.string().startsWith("xoxb-"),
        "app-token": z.string().startsWith("xapp-"),
      }),
      z.object({
        type: z.literal("gh"),
        "poll-interval": z.string().optional(),
      }),
      z.object({
        type: z.literal("discord"),
        "bot-token": z.string().min(10),
      }),
    ]),
    help,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    if (query.type === "slack") {
      funnel.connectors.add({
        type: "slack",
        name: param.name,
        botToken: query["bot-token"],
        appToken: query["app-token"],
      })
    } else if (query.type === "gh") {
      funnel.connectors.add({
        type: "gh",
        name: param.name,
        pollInterval: query["poll-interval"] ? Number(query["poll-interval"]) : undefined,
      })
    } else {
      funnel.connectors.add({
        type: "discord",
        name: param.name,
        botToken: query["bot-token"],
      })
    }

    return c.text(`added connector "${param.name}"`)
  },
)
