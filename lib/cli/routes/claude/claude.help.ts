export const help = `funnel claude — launch Claude Code

usage:
  funnel claude                          launch the default profile (first in the list)
  funnel claude -p <name>                launch a named profile
  funnel claude --profile <name>         (long form)
  funnel claude --channel <name>         raw launch (no profile, cwd = current dir)

options:
  -p, --profile      profile name to launch
  --channel          channel name (raw launch, ignored when --profile is given)

Any other arguments are forwarded to the claude CLI.
On launch the FUNNEL_CHANNEL_ID env var is set and MCP connects to the gateway.`
