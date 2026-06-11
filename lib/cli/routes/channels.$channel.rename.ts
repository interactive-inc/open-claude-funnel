import { factory } from "@/cli/factory"
import { channelsRenameHelp } from "@/cli/routes/channels.rename"

export const channelsChannelRenameHelpHandler = factory.createHandlers((c) =>
  c.text(channelsRenameHelp),
)
