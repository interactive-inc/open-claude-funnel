import { factory } from "@/cli/factory"

const help = `funnel channels <channel> connectors remove <connector> — remove a connector

usage: funnel channels <channel> connectors remove <connector>

Removes the connector from the channel configuration. The gateway drops
it on the next reload. No external resources (Slack apps, Discord bots,
GitHub webhooks) are touched.

examples:
  funnel channels production connectors remove slack-main

see also: funnel channels <channel> connectors, funnel channels <channel> connectors add`

export const channelsConnectorsRemoveHelpHandler = factory.createHandlers((c) => c.text(help))
