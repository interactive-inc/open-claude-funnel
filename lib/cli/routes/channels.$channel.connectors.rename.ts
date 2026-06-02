import { factory } from "@/cli/factory"

const help = `funnel channels <channel> connectors rename <connector> <new-name>

usage: funnel channels <channel> connectors rename <connector> <new-name>`

export const channelsConnectorsRenameHelpHandler = factory.createHandlers((c) => c.text(help))
