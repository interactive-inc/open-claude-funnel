import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/connectors/schedules-remove.help"

export const connectorsSchedulesRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string(), id: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.schedule.removeEntry(param.name, param.id)

    return c.text(`removed schedule entry "${param.id}" from connector "${param.name}"`)
  },
)
