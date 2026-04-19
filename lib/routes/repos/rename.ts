import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/repos/rename.help"

export const reposRenameHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string(), "newName": z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.repositories.rename(param.name, param["newName"])

    return c.text(`renamed repo "${param.name}" to "${param["newName"]}"`)
  },
)
