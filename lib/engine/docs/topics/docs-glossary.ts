export const docsGlossary = `funnel docs glossary — vocabulary reference

Channel
  Subscription mailbox. Holds connectors and decides fan-out behavior.
  See: fnl docs channels.

Connector
  One binding to one external service (slack | gh | discord | schedule),
  nested inside a channel. Has a Listener and (when callable) an Adapter.
  See: fnl docs connectors.

Profile
  Saved launch preset for Claude. Binds a channel and carries argv / env /
  resume / sessionId. Not required to launch.
  See: fnl docs profiles.

LocalConfig
  The funnel.json file at a repo root. Declares channels + profiles for that
  repo and gets an "id" uuid stamped on first launch.
  See: fnl docs local-config.

Gateway
  Long-lived Bun.serve daemon hosting WebSocket + internal HTTP + listener
  listener registry + broadcaster. Required for any realtime flow.
  See: fnl docs gateway.

Listener
  External → Funnel inbound side of a connector. Push (Slack), pull (GitHub),
  or tick (Schedule). Supervised, auto-restarted with backoff.

Adapter
  Claude → external outbound side of a connector. Reached via MCP tool calls
  that hit the gateway over HTTP and dispatch through the adapter.

Broadcaster
  In-gateway component that takes notifies, records them to the event log,
  fans them out to WS subscribers.

FunnelEventLog
  Persistent replay log (default: SQLite). Enables resubscribers to catch up
  from a saved offset via ?since=<N>.

Subscriber ID
  A WS client identifier. Events with meta.target=<id> route to that
  subscriber only — used for per-Claude targeting.

Delivery mode
  fanout (every subscriber gets every event) or exclusive (round-robin one-
  event-one-subscriber). Set on the channel.

MCP
  Model Context Protocol. Funnel hosts an MCP server (fnl mcp) that Claude
  Code launches; events flow in as notifications, outbound calls flow out as
  tool invocations.
  See: fnl docs mcp.

related: fnl docs architecture`
