import { homedir } from "node:os"
import pkg from "@/../package.json" with { type: "json" }
import { dispatchClaude } from "@/cli/dispatch-claude"
import { resolveRepoDir } from "@/cli/resolve-repo-dir"
import { startChannelServer } from "@/engine/mcp/channel-server"
import { toRequest } from "@/cli/router/to-request"
import { routes } from "@/cli/routes"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { FunnelClaude } from "@/engine/claude/claude"
import { FunnelLocalConfig } from "@/engine/local-config/local-config"
import { FunnelLocalConfigSync } from "@/engine/local-config/local-config-sync"
import { FunnelLocalConfigWriter } from "@/engine/local-config/local-config-writer"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { FunnelMcp } from "@/engine/mcp/mcp"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { NodeFunnelTokenPrompter } from "@/engine/token-prompter/node-token-prompter"
import { Funnel } from "@/funnel"

process.title = "funnel"

// A `funnel` CLI launch defaults to a distinct gateway port so it never
// collides with a gateway hosted programmatically on 9742 (e.g. another app
// embedding Funnel). FUNNEL_PORT still overrides. Set before building Funnel so
// every facet — daemon spawn, MCP, listener client — shares the same port.
const CLI_DEFAULT_PORT = 9743

if (!process.env.FUNNEL_PORT) process.env.FUNNEL_PORT = String(CLI_DEFAULT_PORT)

// When the cwd has a funnel.json, scope all funnel state to ~/.funnel/projects/<id>/
// before building Funnel — setting FUNNEL_DIR makes every facet (CLI routing,
// dispatchClaude, MCP, the spawned daemon) resolve to the same root and never
// touch the global ~/.funnel. Node implementations are wired directly here (entry
// point), matching daemon.ts.
const repoFs = new NodeFunnelFileSystem()

const repoDir = resolveRepoDir(
  {
    localConfig: new FunnelLocalConfig({ fs: repoFs }),
    writer: new FunnelLocalConfigWriter({ fs: repoFs }),
    idGenerator: new NodeFunnelIdGenerator(),
    home: homedir(),
  },
  process.cwd(),
)

if (repoDir) process.env.FUNNEL_DIR = repoDir

const funnel = new Funnel({ logger: new NodeFunnelLogger() })
const mcp = new FunnelMcp({ fs: funnel.fs })
const profiles = new FunnelProfiles({ store: funnel.store, idGenerator: funnel.idGenerator })
const localConfig = new FunnelLocalConfig({ fs: funnel.fs })
const localConfigSync = new FunnelLocalConfigSync({
  channels: funnel.channels,
  prompter: new NodeFunnelTokenPrompter(),
})
const claude = new FunnelClaude({
  channels: funnel.channels,
  mcp,
  gateway: funnel.gateway,
  sessions: profiles,
  fs: funnel.fs,
  process: funnel.process,
  idGenerator: funnel.idGenerator,
  logger: funnel.logger,
  dir: funnel.paths.dir,
})

const env = { funnel, claude, profiles, localConfig, localConfigSync }

const HELP = `funnel — Open Claude Funnel

usage: funnel [command]

commands:
  claude                launch Claude Code (default profile or --profile)
  channels              manage channels and their nested connectors
  profiles              manage named launch presets
  gateway               manage the gateway daemon (HTTP + WebSocket)
  status                overall health: gateway, listeners, Claude connections
  debug                 channel diagnosis with next-action hint (--json for Claude)
  schema                print the JSON Schema for funnel.json
  update                update funnel to the latest version
  mcp                   run as an MCP server (invoked from .mcp.json)

options:
  --help, -h            show help
  --version, -v         show version

debugging flow:
  1. fnl status                          is the gateway running? is Claude connected?
  2. fnl debug --channel <name>          what is wrong and what to do next
  3. fnl debug --channel <name> --json   same, structured JSON for Claude to parse
  4. fnl gateway logs                    raw daemon log stream
  5. fnl gateway sql --preset recent     raw inbound event queries

more: funnel <command> --help`

const args = process.argv.slice(2)

if (args.length === 0) {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}

if (args[0] === "--version" || args[0] === "-v") {
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}

if (args[0] === "mcp") {
  await startChannelServer({ dir: funnel.paths.dir })
}

if (args[0] === "claude") {
  const result = await dispatchClaude({ claude, profiles, localConfig, localConfigSync, listeners: funnel.listeners }, args.slice(1))

  if (result.stdout) process.stdout.write(`${result.stdout}\n`)
  if (result.stderr) process.stderr.write(`${result.stderr}\n`)

  process.exit(result.exitCode)
}

if (args[0] !== "mcp" && args[0] !== "claude") {
  const { method, url } = toRequest(args)

  const parsed = new URL(url)

  const wantsHelp = parsed.searchParams.has("help")

  if (wantsHelp && parsed.pathname === "/") {
    process.stdout.write(`${HELP}\n`)
    process.exit(0)
  }

  const res = await routes.request(url, { method }, env)

  if (res.ok) {
    const body = await res.text()
    if (body) process.stdout.write(`${body}\n`)
    process.exit(0)
  }

  if (wantsHelp) {
    const segments = parsed.pathname.split("/").filter(Boolean)
    const group = segments[0]
    const fallback = group
      ? await routes.request(`http://localhost/${group}?help=true`, { method: "GET" }, env)
      : null

    const text = fallback?.ok ? await fallback.text() : HELP
    process.stdout.write(`${text}\n`)
    process.exit(0)
  }

  const text = await res.text()
  if (text) process.stderr.write(`${text}\n`)
  process.exit(1)
}
