import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const profilesRenameHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string(), newName: z.string() })),
  zValidator("query", z.object({})),
  (c) => {
    const param = c.req.valid("param")
    const profiles = c.env.profiles

    profiles.rename(param.profile, param.newName)

    return c.text(`renamed profile "${param.profile}" to "${param.newName}"`)
  },
)
