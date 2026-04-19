import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/profiles/rename.help"

export const profilesRenameHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string(), newName: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.profiles.rename(param.name, param["newName"])

    return c.text(`renamed profile "${param.name}" to "${param["newName"]}"`)
  },
)
