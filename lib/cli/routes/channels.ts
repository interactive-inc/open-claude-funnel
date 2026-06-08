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
  rename <old> <new> / rename a channel
  <name> / show one channel
  <name> set delivery fanout|exclusive / change routing mode
  <name> publish --content=... / push content into a channel
  <name> validate / check connector configuration
  <name> connectors / list connectors
  <name> connectors add <c> --type=... / add a connector
  <name> connectors remove <c> / remove a connector
  <name> connectors set <c> [--bot-token=...] / update connector fields
  <name> connectors rename <c> <new> / rename a connector
  <name> connectors <c> request --method=... / call outbound API
  <name> connectors <c> schedules / list schedule entries
  <name> connectors <c> schedules add <id> / add a schedule entry
  <name> connectors <c> schedules remove <id> / remove a schedule entry

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
