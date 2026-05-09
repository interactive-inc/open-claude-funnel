export const help = `funnel profiles — manage launch profiles

usage: funnel profiles [subcommand]

subcommands:
  (none)                          list (first entry is the default)
  add <name> --path <path> --sub-agent <agent> --channel <channel>
  <name> set [--path ...] [--sub-agent ...] [--channel ...]
  <name> as-default               move profile to the front (becomes default)
  rename <old> <new>              rename
  remove <name>                   remove
  <name> run                      launch (sugar for fnl claude -p <name>)
  <name>                          launch (alias for run)

examples:
  funnel profiles add cto --path /repo/myapp --sub-agent cto --channel prod-inbox
  funnel profiles cto as-default
  funnel profiles cto run`
