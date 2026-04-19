import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/profiles/add.help"

export const profilesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      channel: z.string(),
      repo: z.string().optional(),
      "sub-agent": z.string().optional(),
      "env-file": z.string().optional(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    funnel.profiles.add({
      name: param.name,
      channel: query.channel,
      repo: query.repo,
      subAgent: query["sub-agent"],
      envFiles: query["env-file"] ? [query["env-file"]] : undefined,
    })

    return c.text(`added profile "${param.name}"`)
  },
)
