import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/agents/group.help"

export const agentsGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => {
    const funnel = c.var.funnel
    const agents = funnel.agents.list()

    if (agents.length === 0) return c.text("no agents")

    const lines = agents.map((agent) => {
      const parts = [`channel=${agent.channel}`]

      if (agent.repo) parts.push(`repo=${agent.repo}`)
      if (agent.subAgent) parts.push(`subAgent=${agent.subAgent}`)

      return `${agent.name}  [${parts.join(", ")}]`
    })

    return c.text(lines.join("\n"))
  },
)
