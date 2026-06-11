import { factory } from "@/cli/factory"

export const channelsRenameHelp = `funnel channels rename — rename a channel

usage:
  funnel channels rename <old-channel-name> <new-channel-name>
  funnel channels <old-channel-name> rename <new-channel-name>

Renames the channel in the configuration file. Connectors, schedules,
and delivery mode are preserved. The gateway picks up the new name on
the next reload.

examples:
  funnel channels rename staging production
  funnel channels staging rename production

see also: funnel channels, funnel channels <name>`

export const channelsRenameHelpHandler = factory.createHandlers((c) => c.text(channelsRenameHelp))
