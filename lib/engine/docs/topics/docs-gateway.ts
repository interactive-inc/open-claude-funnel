export const docsGateway = `funnel docs gateway — the WebSocket + HTTP daemon

The gateway hosts every realtime boundary in funnel. Usually it is a
long-lived Bun.serve daemon; it can also run inside your own process.
Without it: store edits work, but no events flow and Claude cannot send
anything outbound.

what runs inside:

  WebSocket /ws                 channel subscriptions (subprotocol auth)
  HTTP /health                  liveness (optional — see healthRoute below)
  HTTP /status /debug           listener registry snapshot and diagnostics
  HTTP /listeners*              listener lifecycle
  HTTP /channels/:channel/connectors/:connector/call
                                outbound dispatch (Claude → adapter → external)
  HTTP /channels/:channel/publish
                                inbound publish (what fnl publish posts to)
  Listener Registry             starts / stops / restarts listeners with
                                exponential backoff (cap 60s)
  Broadcaster                   fans events out to WS clients and records
                                offsets to the event log
  FunnelEventLog                persistent replay log; default is
                                SqliteFunnelEventLog under /tmp/funnel/

who hosts it — three entry points:

  daemon                        Funnel.gateway.start() spawns a separate
                                process; survives your process and is shared
                                by every session on the same funnel dir and
                                port (a scoped repo gets its own daemon)
  Funnel.gatewayServer()        in-process; funnel owns the listen socket
                                (Bun.serve, port / hostname, the non-loopback
                                guard). The daemon itself runs on this
  Funnel.gatewayModule()        in-process; the HOST owns the listen socket.
                                Same gateway internals mounted as one module
                                into your own Hono tree and Bun.serve

FunnelGatewayModule holds everything above under "what runs inside".
FunnelGatewayServer is a thin host that only adds the bind on top of it.
See fnl docs programmable-api for the gatewayModule mounting example.

ports:

  9742    in-process / embedded (Funnel.gatewayServer())
  9743    CLI launches (fnl claude / fnl gateway start)
  FUNNEL_PORT overrides both

  gatewayModule() never binds, so its port option is not a listen port — it
  only names the default replay database (hashed from funnel dir + port).
  Give two modules rooted at the same dir different port values if you want
  them on separate stores; the same pair resolves to the same database.

bind:

  127.0.0.1 (loopback) by default — unreachable off-box.
  FUNNEL_HOST=0.0.0.0 exposes the gateway; in that mode every privileged
  endpoint requires a bearer token, and an unprotected start() throws.

  FUNNEL_HOST is read by the daemon. gatewayServer() takes hostname as an
  option instead, defaults to loopback, and throws on a non-loopback bind
  without a token unless you pass allowInsecureHost. gatewayModule() has no
  bind at all, so it takes no hostname and carries no fail-fast — deciding
  the bind address and protecting a public one is the host's job.

healthRoute:

  gatewayModule({ healthRoute: false }) skips the built-in unauthenticated
  GET /health so a host that already serves its own /health keeps it. Hono
  gives the route to whoever registered first, so without the flag the
  winner depends on mount order. Defaults to true, and it is the only route
  the flag touches — /status, /debug, /listeners* and /channels/* stay
  mounted, and /ws is unaffected because the upgrade never was a Hono route
  (handleUpgrade answers it before the app sees the request).

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
