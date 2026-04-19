export const help = `funnel gateway — manage the gateway

usage: funnel gateway [subcommand]

subcommands:
  status              show running status (default)
  start               start in background
  stop                stop
  restart             stop then start
  run                 start in foreground (for developers)
  logs [-n <N>]       show event logs

examples:
  funnel gateway                check status
  funnel gateway restart        restart`
