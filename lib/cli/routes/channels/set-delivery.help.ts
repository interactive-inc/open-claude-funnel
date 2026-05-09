export const help = `funnel channels <name> set delivery <mode> — change a channel's routing mode

usage: funnel channels <name> set delivery fanout | exclusive

modes:
  fanout      every connected WS client receives every event (default)
  exclusive   each event is delivered to exactly one connected client (round-robin)

tap=all clients (TUI dashboard, debugging) always receive regardless of mode.
`
