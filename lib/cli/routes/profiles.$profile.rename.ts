import { factory } from "@/cli/factory"

const help = `funnel profiles rename — rename a profile

usage:
  funnel profiles rename <old> <new>
  funnel profiles <old> rename <new>`

export const profilesProfileRenameHelpHandler = factory.createHandlers((c) => c.text(help))
