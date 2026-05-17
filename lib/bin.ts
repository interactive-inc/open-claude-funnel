#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" }
import { startChannelServer } from "@/engine/mcp/channel-server"
import { toRequest } from "@/cli/router/to-request"
import { launchTui } from "@/tui/tui"
import { createCliApp } from "@/cli/routes"
import { Funnel } from "@/funnel"

process.title = "funnel"

const funnel = new Funnel()
const app = createCliApp(funnel)

const HELP = `funnel — Open Claude Funnel

usage: funnel [command]

commands:
  (none)                launch TUI
  claude                launch Claude Code (default profile or --profile)
  channels              manage subscription boxes (and their nested connectors)
  profiles              manage launch profiles
  gateway               manage the gateway daemon (HTTP + WS)
  status                show overall connection status
  update                update funnel to the latest version
  mcp                   run as an MCP server (invoked from .mcp.json)

options:
  --help, -h            show help
  --version, -v         show version

more: funnel <command> --help`

const args = process.argv.slice(2)

if (args.length === 0) {
  await launchTui(funnel)
  process.exit(0)
}

if (args[0] === "--version" || args[0] === "-v") {
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}

if (args[0] === "mcp") {
  await startChannelServer({ dir: funnel.paths.dir })
} else {
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
