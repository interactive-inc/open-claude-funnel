import { resolve } from "node:path"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/repos/add.help"

export const reposAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({ path: z.string().optional() }), help),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const path = resolve(query.path ?? process.cwd())

    funnel.repositories.add({ name: param.name, path })

    return c.text(`added repo "${param.name}"`)
  },
)
