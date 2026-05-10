export const help = `funnel gateway logs — tail diagnostic logs

usage: funnel gateway logs [-n <N>]

options:
  -n <N>                number of trailing lines to show (default: 20)

Tails /tmp/funnel/funnel.log (the daemon's diagnostic stream — gateway
lifecycle, channel connect/disconnect, listener boot). Exit with SIGINT.
Output is formatted as YAML.

Domain events fanned out to WebSocket clients live in the SQLite event
store (<logDir>/events.db); they are not shown here. Subscribe via the
WS endpoint or query the store directly.

examples:
  funnel gateway logs
  funnel gateway logs -n 100`
