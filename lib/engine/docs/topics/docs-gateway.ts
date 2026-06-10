export const docsGateway = `funnel docs gateway — the WebSocket + HTTP daemon

The gateway is a long-lived Bun.serve process that hosts every realtime
boundary in funnel. Without it: store edits work, but no events flow and
Claude cannot send anything outbound.

what runs inside:

  WebSocket /                   channel subscriptions (subprotocol auth)
  HTTP /health /status          liveness and supervisor snapshot
  HTTP /listeners*              listener lifecycle
  HTTP /channels/<n>/call       outbound dispatch (Claude → adapter → external)
  Listener Supervisor           starts / stops / restarts listeners with
                                exponential backoff (cap 60s)
  Broadcaster                   fans events out to WS clients and records
                                offsets to the event log
  FunnelEventLog                persistent replay log; default is
                                SqliteFunnelEventLog under /tmp/funnel/

ports:

  9742    in-process / embedded (Funnel.gatewayServer())
  9743    CLI launches (fnl claude / fnl gateway start)
  FUNNEL_PORT overrides both

bind:

  127.0.0.1 (loopback) by default — unreachable off-box.
  FUNNEL_HOST=0.0.0.0 exposes the gateway; in that mode every privileged
  endpoint requires a bearer token, and an unprotected start() throws.

operations:

  fnl gateway                     overview
  fnl gateway status              running? pid? port? uptime?
  fnl gateway start               spawn daemon and wait until /health responds
  fnl gateway stop                stop daemon
  fnl gateway restart             stop + start
  fnl gateway run                 run gateway in the foreground (no daemonize)
  fnl gateway listeners           list listeners with alive / event / error
                                  counts
  fnl gateway logs                stream raw daemon logs
  fnl gateway sql --preset recent query the diagnostic SQLite stores

when do you need the gateway?

  needs gateway:    fnl claude, MCP inbound, MCP outbound (channel call),
                    fnl debug (reads /status + /tmp/funnel/*.db)
  no gateway:       fnl channels add / remove, fnl profiles add, fnl schema

related: fnl docs debugging, fnl docs architecture`
