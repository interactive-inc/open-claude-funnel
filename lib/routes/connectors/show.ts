import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/connectors/show.help"

export const connectorsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const connector = funnel.connectors.get(param.name)

    if (!connector) {
      throw new HTTPException(404, { message: `connector "${param.name}" not found` })
    }

    const lines: string[] = [`name: ${connector.name}`, `type: ${connector.type}`]

    if (connector.type === "slack") {
      lines.push(`botToken: ${connector.botToken.slice(0, 8)}...`)
      lines.push(`appToken: ${connector.appToken.slice(0, 8)}...`)
    } else if (connector.type === "gh") {
      lines.push(`pollInterval: ${connector.pollInterval ?? 60}s`)
    } else if (connector.type === "discord") {
      lines.push(`botToken: ${connector.botToken.slice(0, 8)}...`)
    }

    return c.text(lines.join("\n"))
  },
)
