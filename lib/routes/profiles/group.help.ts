export const help = `funnel profiles — manage launch profiles

usage: funnel profiles [subcommand]

subcommands:
  (none)                          list
  add <name> --channel <ch> [--repo <r>] [--sub-agent <s>] [--env-file <f>]
  <name> set [--channel ...] [--repo ...] [--sub-agent ...] [--env-file ...]
  rename <old> <new>              rename
  remove <name>                   remove
  <name> run                      launch (sugar for fnl claude)
  <name>                          launch (alias for run)

examples:
  funnel profiles add cto --channel prod-inbox --repo myapp --sub-agent cto
  funnel profiles cto run`
