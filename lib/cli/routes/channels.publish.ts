import { factory } from "@/cli/factory"

const help = `funnel channels <channel> publish — push arbitrary content into a channel

usage: funnel channels <channel> publish --content="<text>" [--connector=<name>] [--meta-<key>=<value> ...]

options:
  --content       Required. The event body delivered to subscribers.
  --connector     Optional. Stamp the event with a connector name (resolved to id when found).
  --meta-<key>    Optional. Repeatable. Added to meta. Example: --meta-source=cron`

export const channelsPublishHelpHandler = factory.createHandlers((c) => c.text(help))
