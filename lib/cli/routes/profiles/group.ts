import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/profiles/group.help"

export const profilesGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => {
    const funnel = c.var.funnel
    const profiles = funnel.profiles.list()

    if (profiles.length === 0) return c.text("no profiles")

    const lines = profiles.map((profile, index) => {
      const tag = index === 0 ? " (default)" : ""

      return `${profile.name}${tag}  [path=${profile.path}, sub-agent=${profile.subAgent}, channel=${profile.channelId}]`
    })

    return c.text(lines.join("\n"))
  },
)
