import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/profiles/add.help"

export const profilesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      path: z.string(),
      "sub-agent": z.string(),
      channel: z.string(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    funnel.profiles.add({
      name: param.name,
      path: query.path,
      subAgent: query["sub-agent"],
      channelId: query.channel,
    })

    return c.text(`added profile "${param.name}"`)
  },
)
