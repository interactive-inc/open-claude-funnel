export const docsProgrammableApi = `funnel docs programmable-api — Funnel as an SDK

Everything funnel does as a CLI is also a programmable API. Build your own CLI,
TUI, web UI, or service on top of the same engine — the CLI itself is a thin
Hono app over these services.

── installation ────────────────────────────────────────────────────────────

  npm install @interactive-inc/claude-funnel

── facade ──────────────────────────────────────────────────────────────────

  import { Funnel } from "@interactive-inc/claude-funnel"

  const funnel = new Funnel()             // uses ~/.funnel
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

── building your own CLI ───────────────────────────────────────────────────

The Funnel CLI is a Hono app you can embed:

  import { cliRoutes, toRequest } from "@interactive-inc/claude-funnel"
  import { Funnel } from "@interactive-inc/claude-funnel"

  const funnel = new Funnel()
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
