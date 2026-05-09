export const help = `funnel channels — manage subscription boxes

usage: funnel channels [subcommand]

subcommands:
  (none)                          list
  add <name>                      add
  remove <name>                   remove
  <name>                          show details
  <name> connectors attach <c>    subscribe to a connector
  <name> connectors detach <c>    unsubscribe from a connector

examples:
  funnel channels add prod-inbox
  funnel channels prod-inbox connectors attach prod-slack
  funnel channels prod-inbox`
