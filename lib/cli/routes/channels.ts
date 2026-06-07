import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/cli/yaml-render"

const groupHelp = `funnel channels / manage subscription boxes

usage / funnel channels [subcommand]

subcommands:
  (none) / list every channel with its connectors
  add <name> / create a channel
  remove <name> / delete a channel
  <name> / show one channel
  <name> connectors / list connectors
  <name> connectors add <c> --type=... / add a connector

output / valid YAML

programmable / funnel.channels.list() / .add() / .remove() / .addConnector() / .removeConnector()

examples:
  funnel channels
  funnel channels add prod-inbox
  funnel channels prod-inbox connectors add prod-slack --type=slack --bot-token=xoxb-... --app-token=xapp-...
  funnel channels prod-inbox`

export const channelsGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), groupHelp),
  (c) => {
    const funnel = c.env.funnel
    const channels = funnel.channels.list()

    return c.text(
      renderYaml({
        channels: channels.map((ch) => ({
          id: ch.id,
          name: ch.name,
          delivery: ch.delivery,
          connectors: ch.connectors.map((conn) => ({
            id: conn.id,
            name: conn.name,
            type: conn.type,
          })),
        })),
      }),
    )
  },
)
