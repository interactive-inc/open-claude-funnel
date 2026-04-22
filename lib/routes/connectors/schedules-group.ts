import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/connectors/schedules-group.help"

export const connectorsSchedulesGroupHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const connector = funnel.connectors.get(param.name)

    if (!connector) {
      throw new HTTPException(404, { message: `connector "${param.name}" not found` })
    }

    if (connector.type !== "schedule") {
      throw new HTTPException(400, {
        message: `connector "${param.name}" is type "${connector.type}", not "schedule"`,
      })
    }

    const entries = funnel.schedule.listEntries(param.name)

    if (entries.length === 0) return c.text("no schedule entries")

    const lines: string[] = []

    for (const entry of entries) {
      const status = entry.enabled ? "" : " (disabled)"
      lines.push(`${entry.id}${status}  ${entry.cron}  ${entry.prompt}`)
    }

    return c.text(lines.join("\n"))
  },
)
