import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const removeHelp = `funnel profiles remove — remove a profile

usage: funnel profiles remove <name>`

export const profilesRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator("query", z.object({}), removeHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.profiles.remove(param.profile)

    return c.text(`removed profile "${param.profile}"`)
  },
)
