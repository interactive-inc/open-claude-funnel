import { z } from "zod"
import { factory } from "@/cli/factory"
import { booleanFlag } from "@/cli/router/boolean-flag"
import { zValidator } from "@/cli/router/validator"
import {
  cronExpressionSchema,
  scheduleCatchupPolicySchema,
  scheduleEntrySchema,
} from "@/engine/connectors/schedule-connector-schema"

export const channelsConnectorsSchedulesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string(), id: z.string() })),
  zValidator(
    "query",
    z
      .object({
        cron: cronExpressionSchema.optional(),
        "run-at": z.string().datetime({ offset: true }).optional(),
        prompt: z.string(),
        // NOT z.coerce.boolean(): that runs Boolean("false") === true, so
        enabled: booleanFlag,
        "catchup-policy": scheduleCatchupPolicySchema.optional(),
      })
      .superRefine((query, context) => {
        if ((query.cron === undefined) === (query["run-at"] === undefined)) {
          context.addIssue({
            code: "custom",
            message: "exactly one of --cron or --run-at is required",
          })
        }
      }),
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    const entry = scheduleEntrySchema.parse(
      funnel.channels.connectorOp(param.channel, param.connector, "addEntry", {
        id: param.id,
        ...(query.cron !== undefined ? { cron: query.cron } : { runAt: query["run-at"] }),
        prompt: query.prompt,
        ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
        ...(query["catchup-policy"] !== undefined
          ? { catchupPolicy: query["catchup-policy"] }
          : {}),
      }),
    )

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`added schedule entry "${entry.id}"`)
  },
)
