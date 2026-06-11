import { z } from "zod"
import { factory } from "@/cli/factory"
import { booleanFlag } from "@/cli/router/boolean-flag"
import { zValidator } from "@/cli/router/validator"
import { scheduleCatchupPolicySchema } from "@/engine/connectors/schedule-connector-schema"

export const channelsConnectorsSchedulesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string(), id: z.string() })),
  zValidator(
    "query",
    z.object({
      cron: z.string(),
      prompt: z.string(),
      // NOT z.coerce.boolean(): that runs Boolean("false") === true, so
      enabled: booleanFlag,
      "catchup-policy": scheduleCatchupPolicySchema.optional(),
    }),
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    const entry = funnel.channels.addScheduleEntry(param.channel, param.connector, {
      id: param.id,
      cron: query.cron,
      prompt: query.prompt,
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
      ...(query["catchup-policy"] !== undefined ? { catchupPolicy: query["catchup-policy"] } : {}),
    })

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`added schedule entry "${entry.id}"`)
  },
)
