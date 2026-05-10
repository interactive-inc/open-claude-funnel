import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const renameHelp = `funnel profiles rename — rename a profile

usage:
  funnel profiles rename <old> <new>
  funnel profiles <old> rename <new>`

export const profilesRenameHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string(), newName: z.string() })),
  zValidator("query", z.object({}), renameHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.profiles.rename(param.profile, param.newName)

    return c.text(`renamed profile "${param.profile}" to "${param.newName}"`)
  },
)
