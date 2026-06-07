import { factory } from "@/cli/factory"

const help = `funnel channels <ch> connectors <conn> schedules remove <id>

usage: funnel channels <ch> connectors <conn> schedules remove <id>`

export const channelsConnectorSchedulesRemoveHelpHandler = factory.createHandlers((c) =>
  c.text(help),
)
