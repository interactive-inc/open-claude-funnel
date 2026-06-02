import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const profilesRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator("query", z.object({})),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    funnel.profiles.remove(param.profile)

    return c.text(`removed profile "${param.profile}"`)
  },
)
