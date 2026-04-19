import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/agents/rename.help"

export const agentsRenameHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string(), "newName": z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.agents.rename(param.name, param["newName"])

    return c.text(`renamed agent "${param.name}" to "${param["newName"]}"`)
  },
)
