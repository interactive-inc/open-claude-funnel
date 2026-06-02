import { factory } from "@/cli/factory"

const help = `funnel channels rename — rename a channel

usage:
  funnel channels rename <old> <new>
  funnel channels <old> rename <new>`

export const channelsRenameHelpHandler = factory.createHandlers((c) => c.text(help))
