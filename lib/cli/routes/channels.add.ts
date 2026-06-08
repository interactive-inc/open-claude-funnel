import { factory } from "@/cli/factory"

const help = `funnel channels add — add a channel

usage: funnel channels add <name> [--delivery fanout|exclusive]

options:
  --delivery    routing mode (default fanout):
                  fanout      every connected client receives every event
                  exclusive   each event delivered to exactly one client (round-robin)

A channel is a named event stream. After creating it, add connectors
(Slack, Discord, GitHub, schedule) to feed events into it, then connect
Claude Code clients to consume them.

examples:
  funnel channels add production
  funnel channels add ci-events --delivery exclusive

see also: funnel channels, funnel channels <name> connectors add`

export const channelsAddHelpHandler = factory.createHandlers((c) => c.text(help))
