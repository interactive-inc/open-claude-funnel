export const help = `funnel claude — launch Claude Code

usage:
  funnel claude                          launch the "default" profile
  funnel claude --profile <name>         launch a named profile
  funnel claude --channel <name> [opts]  raw launch (no profile)

options (override profile / raw):
  --profile        profile name to launch
  --channel        channel name to subscribe to
  --repo           switch working directory to the named repo
  --sub-agent      sub-agent name (passed to claude --agent)
  --env-file       additional env file to load (relative path)

Any other arguments are forwarded to the claude CLI.
On launch the FUNNEL_CHANNEL_ID env var is set and MCP connects to the gateway.`
