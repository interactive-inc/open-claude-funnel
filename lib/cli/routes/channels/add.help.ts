export const help = `funnel channels add — add a channel

usage: funnel channels add <name> [--connector <c>] [--delivery fanout|exclusive]

options:
  --connector   attach an existing connector at create time (repeat for multiple)
  --delivery    routing mode (default fanout):
                  fanout      every connected client receives every event
                  exclusive   each event delivered to exactly one client (round-robin)`
