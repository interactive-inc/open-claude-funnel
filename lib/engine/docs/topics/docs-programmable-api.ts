export const docsProgrammableApi = `funnel docs programmable-api — Funnel as an SDK

Everything funnel does as a CLI is also a programmable API. Build your own CLI,
TUI, web UI, or service on top of the same engine — the CLI itself is a thin
Hono app over these services.

── installation ────────────────────────────────────────────────────────────

  npm install @interactive-inc/claude-funnel

── facade ──────────────────────────────────────────────────────────────────

  import { Funnel } from "@interactive-inc/claude-funnel"
  import { slackConnector } from "@interactive-inc/claude-funnel/connectors/slack"

  // Connectors are fully DI: pass only the types you use. The core import
  // never bundles a connector's protocol code (Socket Mode / Gateway / poller)
  // — importing the sub-entry does. With no connectors, the funnel handles
  // zero connector types.
  const funnel = new Funnel({ connectors: [slackConnector()] })  // uses ~/.funnel
  const sandbox = Funnel.inMemory()        // touches no disk / process / clock

  funnel.paths                            // { dir, tmpDir, settings }
  funnel.channels                         // CRUD on channels + nested connectors
  funnel.profiles                         // CRUD on launch presets
  funnel.localConfig                      // funnel.json read / write
  funnel.localConfigSync                  // funnel.json → ~/.funnel sync
  funnel.gateway                          // daemon lifecycle (start/stop/status)
  funnel.gatewayToken                     // bearer token mint/read
  funnel.publisher                        // POST /channels/:name/publish
  funnel.listeners                        // listener registry control
  funnel.claude                           // FunnelClaude (launch Claude Code)
  funnel.diagnostics                      // read-side diagnosis (no mutation)
  funnel.recovery                         // self-healing actions
  funnel.docs                             // embedded documentation

── independent service classes (compose freely) ────────────────────────────

Each service depends on narrow interfaces, so you can wire them outside the
facade if you want a lighter-weight integration. The Funnel facade is the
recommended path — but it is just one composition root, not the only one.

  import {
    FunnelChannels,
    FunnelDiagnostics,
    FunnelRecovery,
    FunnelDocs,
    FunnelGatewayServer,
    FunnelGatewayModule,
    MemoryFunnelFileSystem,
    MemoryFunnelProcessRunner,
    MemoryFunnelClock,
  } from "@interactive-inc/claude-funnel"

── sub-entry imports ───────────────────────────────────────────────────────

For targeted imports (smaller bundle / clearer dependency footprint):

  import { FunnelGatewayServer, FunnelGatewayModule }
                                from "@interactive-inc/claude-funnel/gateway"
  import { FunnelProfiles }      from "@interactive-inc/claude-funnel/profiles"
  import { FunnelLocalConfig }   from "@interactive-inc/claude-funnel/local-config"
  import { slackConnector }      from "@interactive-inc/claude-funnel/connectors/slack"
  import { ghConnector }         from "@interactive-inc/claude-funnel/connectors/gh"
  import { discordConnector }    from "@interactive-inc/claude-funnel/connectors/discord"
  import { scheduleConnector }   from "@interactive-inc/claude-funnel/connectors/schedule"

  // Schedule fires can be observed by passing onFired to the descriptor:
  //   scheduleConnector({ onFired: (entry, firedAt) => { ... } })

── flume 0.9 transport notes ───────────────────────────────────────────────

Slack / Discord / GitHub connectors wrap @interactive-inc/flume 0.9. Each
listener owns a single-source Flume FSM and reconnect is enabled by
default (infinite attempts, 1s base / 30s max exponential backoff +
jitter), so a wifi drop or upstream socket close auto-recovers without
the listener registry intervening.

   Source ctor                      Flume options (cross-cutting)
   -----------                      -----------------------------
   FlumeSlackSource({appToken,      sources / onEvent (firehose) /
       botToken})                   onError / signal / deps / reconnect
   FlumeDiscordSource({token,
       intents})                    Flume 0.9 collapsed every
   FlumeGitHubSource({token,        observation into one firehose: the
       pollInterval})               onEvent callback receives a union of
                                    { kind: "event" } | { kind: "log" }.
                                    Funnel's base listener splits this
                                    back into typed events, log forward,
                                    and status mapping for subclasses.

new Funnel({ signal: controller.signal }) plumbs the AbortSignal down to
every Flume so a host SIGTERM handler can stop every listener cleanly:

   const controller = new AbortController()
   process.on("SIGTERM", () => controller.abort())
   const funnel = new Funnel({
     connectors: [slackConnector(), ghConnector()],
     signal: controller.signal,
   })

Custom connector types: extend FlumeSource from the flume package and
write your own ConnectorDescriptor — that's the only escape hatch for
host-specific protocol logic, since the bundled descriptors don't take
extension hooks.

── in-process gateway: receive events in your own process ──────────────────

The daemon (funnel.gateway.start()) runs in a separate process, so your code
cannot observe its events directly. To receive events in-process, host the
gateway yourself. Two forms, split by who owns the listen socket:

  funnel.gatewayServer(options)   funnel owns Bun.serve (port / hostname, the
                                  non-loopback guard). Add host routes with
                                  extraRoutes. This is what the daemon uses
  funnel.gatewayModule(options)   your app owns Bun.serve and its Hono tree;
                                  the gateway mounts into it as one module

Both expose the same internals (listener registry, broadcaster, event log,
emit / onEvent / getStatus). gatewayServer() is the thin bind-owning host on
top of gatewayModule(); pick the module when funnel is one feature of a bigger
service — e.g. when a config flag turns funnel on and off inside your app.

gatewayServer() — funnel owns the socket:

  import { Funnel, channelWsUrl } from "@interactive-inc/claude-funnel"
  import { slackConnector } from "@interactive-inc/claude-funnel/connectors/slack"

  const funnel = new Funnel({ connectors: [slackConnector()] })
  funnel.channels.add({ name: "inbox" })
  funnel.channels.addConnector("inbox", {
    type: "slack", name: "ops",
    botTokenEnv: "SLACK_BOT_TOKEN", appTokenEnv: "SLACK_APP_TOKEN",
  })

  const server = funnel.gatewayServer({ port: 9742 })
  await server.start()                    // boots listeners, binds HTTP + WS
  server.port                             // resolved port (use port: 0 to auto-assign)

  const unsubscribe = server.onEvent((event) => {
    console.log(event.content, event.meta, event.offset)
  })

  server.emit({ channel: "inbox", content: "hello" })
  // not publisher.publish() — that hops to a daemon PID, which a gatewayServer
  // you host yourself never writes, so it would just return { state: "offline" }

  unsubscribe()
  await server.stop()                    // stops listeners, closes the socket

gatewayModule() — your app owns the socket:

  import { Hono } from "hono"

  const gw = funnel.gatewayModule({ token, eventLog })
  const app = new Hono().route("/", hostRoutes).route("/", gw.app)

  Bun.serve({
    port,
    fetch: (req, server) => {
      const upgrade = gw.handleUpgrade(req, server)
      return upgrade.handled ? upgrade.response : app.fetch(req)
    },
    websocket: gw.websocket,
  })

  await gw.start()                       // boots listeners; binds nothing

  gw.app                                 // Hono sub-app (auth included)
  gw.handleUpgrade(req, server)          // /ws upgrade decision, three states
  gw.websocket                           // Bun WebSocketHandler for it
  gw.emit(event) / gw.onEvent(handler)   // same surface as the server

start() first clears competing gateway daemons rooted at the same funnel dir
(they would share Slack tokens and split inbound events); pass
killCompetingSlack: false to skip it. A stale one may still hold your port,
so a host that binds should run gw.killCompetingSlackIfNeeded() itself
*before* Bun.serve — it is first-call-wins, so the later start() will not
repeat it behind your own socket.

handleUpgrade returns three states on purpose — do not collapse it to
Response | undefined:

  { handled: false }                     not a /ws upgrade (wrong path or no
                                         Upgrade header); route it yourself
  { handled: true, response: Response }  rejected (401 / 404 / 400); return it
  { handled: true, response: undefined } upgraded; return undefined to Bun

"upgraded" and "not mine" would both be undefined, so a host writing
gw.handleUpgrade(req, server) ?? app.fetch(req) answers an already-upgraded
socket with a 404 body.

healthRoute: false skips the built-in unauthenticated GET /health. Pass it
when your app already serves its own /health: Hono gives the path to whoever
registered first, so otherwise the winner silently depends on mount order.
It is the only route the flag touches: /status, /debug, /listeners* and
/channels/* stay mounted, and /ws is unaffected because handleUpgrade answers
the upgrade before the Hono app ever sees it.

The module never binds, so it takes no hostname and carries no non-loopback
fail-fast — the bind address and its protection are the host's call. Its port
option only names the default replay database. Shutdown is yours too — the
module never closes your socket, and dispose() only closes an event log it
created, never one you injected. Stop in the order that fits your host:
gw.stopListeners(), close your socket, then gw.dispose(); gw.stop() is just
the first and last of those together.

To observe a daemon (separate process) instead, connect a WebSocket client:

  const url = channelWsUrl({ base: "ws://127.0.0.1:9743/ws", channel: "inbox" })
  const ws = new WebSocket(url, channelWsProtocols(token))

── publishing: publisher.publish vs server emit ────────────────────────────

  funnel.publisher.publish(channel, req)  // HTTP hop to the daemon; works from
                                          // any process; returns { state: "ok" |
                                          // "offline" | "error" }
  server.emit(event)                      // direct in-process injection into a
  gw.emit(event)                          // gatewayServer() / gatewayModule()
                                          // you host yourself; no HTTP, no
                                          // offline state

Rule of thumb: talking to the shared daemon → publish; hosting the gateway
in your own process → emit (or publish against your own port).

── error handling: two deliberate styles ───────────────────────────────────

  - Engine CRUD (channels / profiles / localConfig) THROWS. A failure there is
    a programming or configuration error (duplicate name, unknown channel) —
    let it surface, or try/catch at your boundary.
  - Gateway clients (publisher / listeners / gateway / recovery) return result
    objects like { state: "ok" | "offline" | "error" } or { ok, actions }. A
    daemon being down is an expected runtime state, not an exception.

If a method talks over HTTP to a daemon that might not be running, expect a
result object; otherwise expect a throw.

── building your own CLI ───────────────────────────────────────────────────

The Funnel CLI is a Hono app you can embed:

  import { cliRoutes, toRequest } from "@interactive-inc/claude-funnel"
  import { Funnel } from "@interactive-inc/claude-funnel"
  import { slackConnector } from "@interactive-inc/claude-funnel/connectors/slack"
  import { ghConnector } from "@interactive-inc/claude-funnel/connectors/gh"

  // List every connector type your CLI's "channels ... connectors" commands accept.
  const funnel = new Funnel({ connectors: [slackConnector(), ghConnector()] })
  const { method, url } = toRequest(process.argv.slice(2))
  const res = await cliRoutes.request(url, { method }, { funnel })

Or skip the routing layer entirely and call the services directly:

  await funnel.diagnostics.diagnoseAll()
  await funnel.recovery.restartAllDeadListeners()

── testing ─────────────────────────────────────────────────────────────────

Every IO boundary has a Memory implementation. Wire a sandboxed Funnel for
fast, hermetic tests:

  import { Funnel } from "@interactive-inc/claude-funnel"
  const funnel = Funnel.inMemory()

  funnel.channels.add({ name: "ops" })
  expect(funnel.channels.list()).toHaveLength(1)

related: fnl docs architecture, fnl docs debugging, fnl docs mcp`
