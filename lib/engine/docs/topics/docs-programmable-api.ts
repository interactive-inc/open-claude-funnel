export const docsProgrammableApi = `funnel docs programmable-api — Funnel as an SDK

Everything funnel does as a CLI is also a programmable API. Build your own CLI,
TUI, web UI, or service on top of the same engine — the CLI itself is a thin
Hono app over these services.

── installation ────────────────────────────────────────────────────────────

  npm install @interactive-inc/claude-funnel

── facade ──────────────────────────────────────────────────────────────────

  import { Funnel } from "@interactive-inc/claude-funnel"
  import { slackConnector } from "@interactive-inc/claude-funnel/connectors/slack"

  // Connectors are fully DI: pass only the types you use. The core import never
  // bundles a connector SDK (@slack/bolt, discord.js) — importing the sub-entry
  // does. With no connectors, the funnel handles zero connector types.
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
    MemoryFunnelFileSystem,
    MemoryFunnelProcessRunner,
    MemoryFunnelClock,
  } from "@interactive-inc/claude-funnel"

── sub-entry imports ───────────────────────────────────────────────────────

For targeted imports (smaller bundle / clearer dependency footprint):

  import { FunnelGatewayServer } from "@interactive-inc/claude-funnel/gateway"
  import { FunnelProfiles }      from "@interactive-inc/claude-funnel/profiles"
  import { FunnelLocalConfig }   from "@interactive-inc/claude-funnel/local-config"
  import { slackConnector }      from "@interactive-inc/claude-funnel/connectors/slack"
  import { ghConnector }         from "@interactive-inc/claude-funnel/connectors/gh"
  import { discordConnector }    from "@interactive-inc/claude-funnel/connectors/discord"
  import { scheduleConnector }   from "@interactive-inc/claude-funnel/connectors/schedule"

  // Connector launch hooks are closed over by the descriptor factory:
  //   slackConnector({ onAppCreated, preprocessEvent })
  //   scheduleConnector({ onFired })

── in-process gateway: receive events in your own process ──────────────────

The daemon (funnel.gateway.start()) runs in a separate process, so your code
cannot observe its events directly. To receive events in-process, host the
gateway yourself with gatewayServer():

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

  await funnel.publisher.publish("inbox", { content: "hello" })

  unsubscribe()
  await server.stop()                    // stops listeners, closes the socket

To observe a daemon (separate process) instead, connect a WebSocket client:

  const url = channelWsUrl({ base: "ws://127.0.0.1:9743/ws", channel: "inbox" })
  const ws = new WebSocket(url, channelWsProtocols(token))

── publishing: publisher.publish vs server emit ────────────────────────────

  funnel.publisher.publish(channel, req)  // HTTP hop to the daemon; works from
                                          // any process; returns { state: "ok" |
                                          // "offline" | "error" }
  server.emit(event)                      // direct in-process injection into a
                                          // gatewayServer() you host yourself;
                                          // no HTTP, no offline state

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
