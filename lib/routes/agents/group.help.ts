export const help = `funnel agents — agent presets (extra)

usage: funnel agents [subcommand]

subcommands:
  (none)                          list
  add <name> --channel <ch> [--repo <r>] [--sub-agent <s>] [--env-file <f>]
  remove <name>                   remove
  <name>                          launch (sugar for fnl claude)

examples:
  funnel agents add cto --channel prod-inbox --repo myapp --sub-agent cto
  funnel agents cto`
