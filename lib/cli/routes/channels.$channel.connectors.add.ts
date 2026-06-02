import { factory } from "@/cli/factory"

const help = `funnel channels <channel> connectors add <connector> — add a connector to a channel

usage:
  funnel channels <channel> connectors add <connector> --type=slack --bot-token=xoxb-... --app-token=xapp-...
  funnel channels <channel> connectors add <connector> --type=gh [--poll-interval=60]
  funnel channels <channel> connectors add <connector> --type=discord --bot-token=...
  funnel channels <channel> connectors add <connector> --type=schedule

Token uniqueness is enforced across all channels.`

export const channelsConnectorsAddHelpHandler = factory.createHandlers((c) => c.text(help))
