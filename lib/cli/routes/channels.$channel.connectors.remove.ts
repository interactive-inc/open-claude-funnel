import { factory } from "@/cli/factory"

const help = `funnel channels <channel> connectors remove <connector> — remove a connector

usage: funnel channels <channel> connectors remove <connector>`

export const channelsConnectorsRemoveHelpHandler = factory.createHandlers((c) => c.text(help))
