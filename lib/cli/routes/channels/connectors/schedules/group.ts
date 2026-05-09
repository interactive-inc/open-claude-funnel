import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/connectors/schedules/group.help"

export const channelsConnectorsSchedulesGroupHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const entries = funnel.channels.listScheduleEntries(param.channel, param.connector)

    if (entries.length === 0) return c.text("no schedule entries")

    return c.text(
      entries
        .map((e) => `${e.id}\t${e.cron}\t${e.enabled ? "on" : "off"}\t${e.prompt}`)
        .join("\n"),
    )
  },
)
