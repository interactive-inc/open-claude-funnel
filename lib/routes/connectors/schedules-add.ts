import { z } from "zod"
import { factory } from "@/factory"
import { matchCron } from "@/modules/connectors/match-cron"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/connectors/schedules-add.help"

export const connectorsSchedulesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      cron: z.string(),
      prompt: z.string(),
      disabled: z.string().optional(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    matchCron(query.cron, new Date())

    const entry = funnel.schedule.addEntry(param.name, {
      cron: query.cron,
      prompt: query.prompt,
      enabled: query.disabled !== "true",
    })

    return c.text(`added schedule entry "${entry.id}" to connector "${param.name}"`)
  },
)
