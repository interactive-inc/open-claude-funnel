import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { scheduleEntrySchema } from "@/engine/connectors/schedule-connector-schema"

const groupHelp = `funnel channels <ch> connectors <conn> schedules — manage schedule entries

usage: funnel channels <ch> connectors <conn> schedules [subcommand]

subcommands:
  (none) / list schedule entries
  add <id> --cron=... --prompt=... [--enabled=true] [--catchup-policy=latest|all|skip] / add entry
  remove <id> / remove entry`

export const channelsConnectorsSchedulesGroupHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  helpGuard(groupHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel
    const entries = z
      .array(scheduleEntrySchema)
      .parse(funnel.channels.connectorOp(param.channel, param.connector, "listEntries", undefined))

    if (entries.length === 0) return c.text("no schedule entries")

    return c.text(
      entries.map((e) => `${e.id}\t${e.cron}\t${e.enabled ? "on" : "off"}\t${e.prompt}`).join("\n"),
    )
  },
)
