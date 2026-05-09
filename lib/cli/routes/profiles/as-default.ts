import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/profiles/as-default.help"

export const profilesAsDefaultHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.profiles.asDefault(param.name)

    return c.text(`profile "${param.name}" is now the default`)
  },
)
