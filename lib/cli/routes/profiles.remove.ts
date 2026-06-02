import { factory } from "@/cli/factory"

const help = `funnel profiles remove — remove a profile

usage: funnel profiles remove <name>`

export const profilesRemoveHelpHandler = factory.createHandlers((c) => c.text(help))
