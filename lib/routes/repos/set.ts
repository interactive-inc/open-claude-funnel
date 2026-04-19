import { resolve } from "node:path"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/repos/set.help"

export const reposSetHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({ path: z.string().optional() }), help),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    funnel.repositories.update(param.name, {
      path: query.path !== undefined ? resolve(query.path) : undefined,
    })

    return c.text(`updated repo "${param.name}"`)
  },
)
