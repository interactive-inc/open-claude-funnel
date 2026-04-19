export const help = `funnel claude — launch Claude Code

usage: funnel claude --channel <name> [--repo <name>] [--sub-agent <name>] [--env-file <file>] [additional claude args...]

options:
  --channel        channel name to subscribe to (required)
  --repo           switch working directory to the named repo (extra)
  --sub-agent      sub-agent name (passed to claude --agent)
  --env-file       additional env file to load (relative path)

On launch the FUNNEL_CHANNEL_ID env var is set and MCP connects to the gateway.`
