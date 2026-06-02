import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

const groupHelp = `funnel channels <ch> connectors <conn> schedules — list schedule entries

usage: funnel channels <ch> connectors <conn> schedules`

export const channelsConnectorsSchedulesGroupHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", z.object({}), groupHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel
    const entries = funnel.channels.listScheduleEntries(param.channel, param.connector)

    if (entries.length === 0) return c.text("no schedule entries")

    return c.text(
      entries.map((e) => `${e.id}\t${e.cron}\t${e.enabled ? "on" : "off"}\t${e.prompt}`).join("\n"),
    )
  },
)
