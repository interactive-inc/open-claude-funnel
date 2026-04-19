import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/repos/group.help"

export const reposGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => {
    const funnel = c.var.funnel
    const repos = funnel.repositories.list()

    if (repos.length === 0) return c.text("no repos")

    const lines = repos.map((repo) => `${repo.name}  ${repo.path}`)

    return c.text(lines.join("\n"))
  },
)
