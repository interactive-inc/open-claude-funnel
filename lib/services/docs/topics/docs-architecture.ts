export const docsArchitecture = `funnel docs architecture — how Funnel routes events

Funnel is a hub between external sources (Slack / GitHub / Discord / cron) and
Claude Code agents. Events flow one way; replies flow back via MCP tools.

  external sources → daemon → channel → agent (MCP)
                         ↑ ← outbound replies (MCP tools)

layers (dependency direction):

  engine ← connectors ← gateway ← cli
                                ↖ bin.ts → funnel.ts (facade)

  engine      core domain (channels, profiles, settings, mcp, local-config)
  connectors  slack / gh / discord / schedule implementations
  gateway     Bun.serve hosting WS + internal HTTP, listener supervisor,
              broadcaster, event log (SQLite by default)
  cli         argv → internal HTTP requests → Hono routes

runtime processes:

  daemon         long-lived gateway in its own process; spawned by fnl claude;
                 shared across Claude sessions and repos
  in-process     same gateway hosted inside the embedding process; for tests
                 and custom hosts; observe events with onEvent()

storage roots:

  ~/.funnel/                       global daemon state (PID, token, settings)
  ~/.funnel/projects/<id>/         per-repo state when funnel.json exists
  /tmp/funnel/                     event store + connector diagnostic SQLite

key invariants:

  - listener and adapter are separate one-way pipes (broadcaster sees only
    inbound events, not outbound tool calls)
  - per-repo state is fully isolated from global state — they never mix
  - URL building is type-safe via channelWsUrl / gatewayLoopbackUrl helpers

related: fnl docs channels, fnl docs profiles, fnl docs mcp`
