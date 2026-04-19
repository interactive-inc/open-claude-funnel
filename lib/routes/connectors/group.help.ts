export const help = `funnel connectors — manage external connections (Slack, etc.)

usage: funnel connectors [subcommand]

subcommands:
  (none)                       list
  add <name> --type slack --bot-token <t> --app-token <t>
  remove <name>
  <name>                       show details

examples:
  funnel connectors add prod-slack --type slack --bot-token xoxb-... --app-token xapp-...
  funnel connectors
  funnel connectors remove prod-slack`
