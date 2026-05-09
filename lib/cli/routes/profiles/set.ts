import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/profiles/set.help"

export const profilesSetHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      path: z.string().optional(),
      "sub-agent": z.string().optional(),
      channel: z.string().optional(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    funnel.profiles.update(param.name, {
      path: query.path,
      subAgent: query["sub-agent"],
      channelId: query.channel,
    })

    return c.text(`updated profile "${param.name}"`)
  },
)
