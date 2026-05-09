export const help = `funnel gateway — manage the funnel daemon

The gateway daemon hosts the WebSocket /ws (used by Claude MCP), the
local web UI at /, and the listener supervisor that runs every
connector. One daemon, one port (9742), one PID file.

usage: funnel gateway [subcommand]

subcommands:
  status              show running status (default)
  start               start in background
  stop                stop
  restart             stop then start
  run                 start in foreground (for developers)
  logs [-n <N>]       show event logs
  listeners           list running connector listeners (alive / dead)

examples:
  funnel gateway                check status
  funnel gateway restart        restart`
