import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

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
