import { factory } from "@/cli/factory"

const help = `funnel channels <channel> connectors add <name> — add a connector to a channel

usage:
  funnel channels <channel> connectors add <name> --type=slack --bot-token=xoxb-... --app-token=xapp-...
  funnel channels <channel> connectors add <name> --type=gh [--poll-interval=60]
  funnel channels <channel> connectors add <name> --type=discord --bot-token=...
  funnel channels <channel> connectors add <name> --type=schedule

connector types:
  slack      Slack Socket Mode (requires bot-token + app-token)
  gh         GitHub webhook polling
  discord    Discord bot gateway
  schedule   cron / one-shot timer (no external service)

Token uniqueness is enforced across all channels — the same bot-token
cannot appear in two connectors.

examples:
  funnel channels prod connectors add main-slack --type=slack --bot-token=xoxb-... --app-token=xapp-...
  funnel channels ci connectors add gh-events --type=gh --poll-interval=30
  funnel channels alerts connectors add daily --type=schedule

see also: funnel channels <channel> connectors, funnel channels <channel> connectors remove`

export const channelsConnectorsAddHelpHandler = factory.createHandlers((c) => c.text(help))
