import { factory } from "@/cli/factory"

const help = `funnel channels <channel> connectors rename <old-connector-name> <new-connector-name> — rename a connector

usage: funnel channels <channel> connectors rename <old-connector-name> <new-connector-name>

Renames the connector in the configuration file. Tokens, type, and
schedules are preserved. The gateway picks up the new name on the
next reload.

examples:
  funnel channels production connectors rename slack-1 slack-main

see also: funnel channels <channel> connectors`

export const channelsConnectorsRenameHelpHandler = factory.createHandlers((c) => c.text(help))
