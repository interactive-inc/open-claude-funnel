import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/profiles/remove.help"

export const profilesRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.profiles.remove(param.name)

    return c.text(`removed profile "${param.name}"`)
  },
)
