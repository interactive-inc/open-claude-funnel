import { factory } from "@/cli/factory"

const help = `funnel channels remove — remove a channel and all its connectors

usage: funnel channels remove <name>

The channel, its connectors, and their schedules are deleted from the
configuration file. The gateway drops the channel on the next reload.
No external resources (Slack apps, Discord bots, etc.) are touched.

examples:
  funnel channels remove staging

see also: funnel channels, funnel channels add`

export const channelsRemoveHelpHandler = factory.createHandlers((c) => c.text(help))
