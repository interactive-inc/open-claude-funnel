import { factory } from "@/cli/factory"

const help = `funnel profiles <name> set — update a profile

usage: funnel profiles <name> set [--path <path>] [--channel <channel-name>] [recipe]

options:
  --path        working directory passed to claude as cwd
  --channel     channel name (resolved to channel id internally)
  --agent       sub-agent name, prepended to the launch argv as --agent <name>
  --options     extra launch argv as one whitespace-split string (e.g. "--brief")
  --env         env vars layered under the process, as "KEY=VAL,KEY2=VAL2"
  --resume / --no-resume  toggle claude session reuse

Only the flags you pass are changed; --agent and --options together replace
the profile's whole options list.`

export const profilesSetHelpHandler = factory.createHandlers((c) => c.text(help))
