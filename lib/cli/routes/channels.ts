import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const groupHelp = `funnel channels — manage subscription boxes

usage: funnel channels [--json]

options:
  --json                output as JSON array (machine-readable, useful for Claude)

subcommands:
  (none)                          list
  add <name>                      add
  remove <name>                   remove
  <name>                          show details
  <name> connectors                       list connectors
  <name> connectors add <c> --type=...    add a connector

examples:
  funnel channels
  funnel channels --json
  funnel channels add prod-inbox
  funnel channels prod-inbox connectors add prod-slack --type=slack --bot-token=xoxb-... --app-token=xapp-...
  funnel channels prod-inbox`

export const channelsGroupHandler = factory.createHandlers(
  zValidator("query", z.object({ json: z.enum(["true", "false", ""]).optional() }), groupHelp),
  (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const channels = funnel.channels.list()
    const isJson = query.json === "true" || query.json === ""

    if (isJson) {
      return c.json(
        channels.map((ch) => ({
          id: ch.id,
          name: ch.name,
          delivery: ch.delivery,
          connectors: ch.connectors.map((conn) => ({
            id: conn.id,
            name: conn.name,
            type: conn.type,
          })),
        })),
      )
    }

    if (channels.length === 0) return c.text("no channels")

    const lines = channels.map((ch) => {
      const names = ch.connectors.map((conn) => conn.name)
      const connectors = names.length > 0 ? names.join(", ") : "(none)"

      return `${ch.name} [${connectors}]`
    })

    return c.text(lines.join("\n"))
  },
)
