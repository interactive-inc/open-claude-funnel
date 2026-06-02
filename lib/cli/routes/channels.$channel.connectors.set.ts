import { factory } from "@/cli/factory"

const help = `funnel channels <channel> connectors set <connector> — update connector fields

usage:
  funnel channels <ch> connectors set <conn> [--bot-token=...] [--app-token=...]   # slack
  funnel channels <ch> connectors set <conn> [--bot-token=...]                    # discord
  funnel channels <ch> connectors set <conn> [--poll-interval=N]                  # gh`

export const channelsConnectorsSetHelpHandler = factory.createHandlers((c) => c.text(help))
