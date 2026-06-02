import { factory } from "@/cli/factory"

const help = `funnel profiles add — add a profile

usage: funnel profiles add <name> --path <path> --channel <channel-name> [recipe]

options:
  --path        working directory passed to claude as cwd
  --channel     channel name (resolved to channel id internally)
  --agent       sub-agent name, prepended to the launch argv as --agent <name>
  --options     extra launch argv as one whitespace-split string (e.g. "--brief")
  --env         env vars layered under the process, as "KEY=VAL,KEY2=VAL2"
  --no-resume   start a fresh claude session every launch (default resumes)

The launch recipe (--agent / --options / --env / --resume) lives on the
profile; the channel only declares transport (connectors / delivery).`

export const profilesAddHelpHandler = factory.createHandlers((c) => c.text(help))
