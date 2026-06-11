import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { notFoundMessage } from "@/cli/routes/not-found-message"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"

const groupHelp = `funnel channels <channel> connectors — manage connectors in a channel

usage: funnel channels <channel> connectors [subcommand]

subcommands:
  (none) / list connectors
  add <c> --type=... / add a connector
  remove <c> / remove a connector
  set <c> [--bot-token=...] / update connector fields
  rename <c> <new> / rename a connector
  <c> / show one connector
  <c> rename <new> / rename (alternative form)
  <c> request --method=... / call connector outbound API
  <c> schedules / list schedule entries (schedule type only)
  <c> schedules add <id> --cron=... --prompt=... / add a schedule entry
  <c> schedules remove <id> / remove a schedule entry`

export const channelsConnectorsGroupHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  helpGuard(groupHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel
    const channel = funnel.channels.get(param.channel)

    if (!channel) {
      throw new HTTPException(404, {
        message: notFoundMessage({
          kind: "channel",
          name: param.channel,
          available: funnel.channels.list().map((ch) => ch.name),
          nextAction: "fnl channels add <name>",
        }),
      })
    }

    if (channel.connectors.length === 0) return c.text(`no connectors in channel "${channel.name}"`)

    return c.text(channel.connectors.map((c) => `${c.name} (${c.type}, id: ${c.id})`).join("\n"))
  },
)
