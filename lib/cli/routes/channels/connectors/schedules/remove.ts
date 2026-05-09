import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/connectors/schedules/remove.help"

export const channelsConnectorsSchedulesRemoveHandler = factory.createHandlers(
  zValidator(
    "param",
    z.object({ channel: z.string(), connector: z.string(), id: z.string() }),
  ),
  zValidator("query", z.object({}), help),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.channels.removeScheduleEntry(param.channel, param.connector, param.id)

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`removed schedule entry "${param.id}"`)
  },
)
