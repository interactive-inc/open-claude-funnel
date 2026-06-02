import { factory } from "@/cli/factory"

const help = `funnel channels remove — remove a channel

usage: funnel channels remove <name>`

export const channelsRemoveHelpHandler = factory.createHandlers((c) => c.text(help))
