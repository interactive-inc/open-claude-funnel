import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/profiles/group.help"

export const profilesGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => {
    const funnel = c.var.funnel
    const profiles = funnel.profiles.list()

    if (profiles.length === 0) return c.text("no profiles")

    const lines = profiles.map((profile) => {
      const parts = [`channel=${profile.channel}`]

      if (profile.repo) parts.push(`repo=${profile.repo}`)
      if (profile.subAgent) parts.push(`subAgent=${profile.subAgent}`)

      return `${profile.name}  [${parts.join(", ")}]`
    })

    return c.text(lines.join("\n"))
  },
)
