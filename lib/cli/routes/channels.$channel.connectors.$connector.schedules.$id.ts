import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { scheduleCatchupPolicySchema } from "@/connectors/schedule-connector-schema"

export const addHelp = `funnel channels <ch> connectors <conn> schedules add <id> — add a schedule entry

usage: funnel channels <ch> connectors <conn> schedules add <id> --cron="*/5 * * * *" --prompt="..." [--enabled=true] [--catchup-policy=latest|all|skip]`

export const channelsConnectorsSchedulesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string(), id: z.string() })),
  zValidator(
    "query",
    z.object({
      cron: z.string(),
      prompt: z.string(),
      enabled: z.coerce.boolean().optional(),
      catchupPolicy: scheduleCatchupPolicySchema.optional(),
    }),
    addHelp,
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const entry = funnel.channels.addScheduleEntry(param.channel, param.connector, {
      id: param.id,
      cron: query.cron,
      prompt: query.prompt,
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
      ...(query.catchupPolicy !== undefined ? { catchupPolicy: query.catchupPolicy } : {}),
    })

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`added schedule entry "${entry.id}"`)
  },
)

export const removeHelp = `funnel channels <ch> connectors <conn> schedules remove <id>

usage: funnel channels <ch> connectors <conn> schedules remove <id>`

export const channelsConnectorsSchedulesRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string(), id: z.string() })),
  zValidator("query", z.object({}), removeHelp),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.channels.removeScheduleEntry(param.channel, param.connector, param.id)

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`removed schedule entry "${param.id}"`)
  },
)
