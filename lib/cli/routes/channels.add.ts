import { factory } from "@/cli/factory"

const help = `funnel channels add — add a channel

usage: funnel channels add <name> [--delivery fanout|exclusive]

options:
  --delivery    routing mode (default fanout):
                  fanout      every connected client receives every event
                  exclusive   each event delivered to exactly one client (round-robin)`

export const channelsAddHelpHandler = factory.createHandlers((c) => c.text(help))
