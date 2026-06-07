export const docsMcp = `funnel docs mcp — the MCP server inside funnel

\`fnl mcp\` is invoked by Claude Code via .mcp.json (auto-installed when fnl
claude runs in a repo). It hosts two independent pipes over one stdio MCP
server.

inbound (events → Claude):

  - WebSocket subscribes to the gateway on the channel set by FUNNEL_CHANNEL_ID
  - forwards messages as MCP notifications under method
    "notifications/claude/channel"
  - capability "experimental: { claude/channel: {} }" must be enabled
  - auto-reconnects with exponential backoff and replays missed events using
    ?since=<offset> against the gateway's persistent event log

outbound (Claude → external):

  - reads the channel's connectors at startup
  - exposes one MCP tool per connector (one tool = one connector name)
  - tool args: { method, path, body? }
  - tool calls become HTTP POST to the gateway's channel call endpoint with
    Bearer auth; the JSON response is returned to Claude verbatim (no bash hop)
  - schedule connectors are excluded (no outbound side)

built-in diagnostic tool:

  - funnel_diagnose
    returns the same structured report as \`fnl debug --all --json\`.
    Call this when events stop arriving, when a tool call fails, or before
    asking the user to check anything. No arguments required.

env contract:

  FUNNEL_CHANNEL_ID   set by launcher; without it the inbound side is no-op
  FUNNEL_DIR          state root; set by the launcher for repo-scoped runs
  FUNNEL_PORT         gateway port; default 9743 for CLI launch, 9742 for
                      embedded use

operations:

  fnl mcp                  run as MCP server (do not invoke manually — Claude
                           launches it via .mcp.json)

related: fnl docs claude, fnl docs debugging`
