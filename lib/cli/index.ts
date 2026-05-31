import { homedir } from "node:os"
import pkg from "@/../package.json" with { type: "json" }
import { dispatchClaude } from "@/cli/dispatch-claude"
import { resolveRepoDir } from "@/cli/resolve-repo-dir"
import { startChannelServer } from "@/engine/mcp/channel-server"
import { toRequest } from "@/cli/router/to-request"
import { createCliApp } from "@/cli/routes"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { FunnelLocalConfig } from "@/engine/local-config/local-config"
import { FunnelLocalConfigWriter } from "@/engine/local-config/local-config-writer"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { Funnel } from "@/funnel"

process.title = "funnel"

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

const app = createCliApp(funnel)

const HELP = `funnel — Open Claude Funnel

usage: funnel [command]

commands:
  (none)                show help
  claude                launch Claude Code (default profile or --profile)
  channels              manage subscription boxes (and their nested connectors)
  profiles              manage launch profiles
  gateway               manage the gateway daemon (HTTP + WS)
  status                show overall connection status
  schema                print the JSON Schema for funnel.json
  update                update funnel to the latest version
  mcp                   run as an MCP server (invoked from .mcp.json)

options:
  --help, -h            show help
  --version, -v         show version

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
  const result = await dispatchClaude({ funnel }, args.slice(1))

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

  const res = await app.request(url, { method })

  if (res.ok) {
    const body = await res.text()
    if (body) process.stdout.write(`${body}\n`)
    process.exit(0)
  }

  if (wantsHelp) {
    const segments = parsed.pathname.split("/").filter(Boolean)
    const group = segments[0]
    const fallback = group
      ? await app.request(`http://localhost/${group}?help=true`, { method: "GET" })
      : null

    const text = fallback?.ok ? await fallback.text() : HELP
    process.stdout.write(`${text}\n`)
    process.exit(0)
  }

  const text = await res.text()
  if (text) process.stderr.write(`${text}\n`)
  process.exit(1)
}
