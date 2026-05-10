import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const groupHelp = `funnel channels — manage subscription boxes

usage: funnel channels [subcommand]

subcommands:
  (none)                          list
  add <name>                      add
  remove <name>                   remove
  <name>                          show details
  <name> connectors                       list connectors
  <name> connectors add <c> --type=...    add a connector

examples:
  funnel channels add prod-inbox
  funnel channels prod-inbox connectors add prod-slack --type=slack --bot-token=xoxb-... --app-token=xapp-...
  funnel channels prod-inbox`

export const channelsGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), groupHelp),
  (c) => {
    const funnel = c.var.funnel
    const channels = funnel.channels.list()

    if (channels.length === 0) return c.text("no channels")

    const lines = channels.map((ch) => {
      const names = ch.connectors.map((c) => c.name)
      const connectors = names.length > 0 ? names.join(", ") : "(none)"

      return `${ch.name} [${connectors}]`
    })

    return c.text(lines.join("\n"))
  },
)
