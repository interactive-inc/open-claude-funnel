#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" }
import { startChannelServer } from "@/engine/mcp/channel-server"
import { toRequest } from "@/cli/router/to-request"
import { launchTui } from "@/tui/tui"
import { app } from "@/cli/routes"
import { Funnel } from "@/funnel"

process.title = "funnel"

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
  await launchTui(new Funnel())
  process.exit(0)
}

if (args[0] === "--version" || args[0] === "-v") {
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}

if (args[0] === "mcp") {
  await startChannelServer()
} else {
  const { method, url } = toRequest(args)

  const parsed = new URL(url)

  if (parsed.searchParams.has("help")) {
    if (parsed.pathname === "/") {
      process.stdout.write(`${HELP}\n`)
      process.exit(0)
    }

    let res = await app.request(url, { method })

    const segments = parsed.pathname.split("/").filter(Boolean)
    const group = segments[0]

    if (!res.ok && method !== "GET" && group && segments.length === 1) {
      res = await app.request(`http://localhost/${group}/_help_?help=true`, { method })
    }

    if (!res.ok && method !== "GET") {
      res = await app.request(url, { method: "GET" })
    }

    if (!res.ok && group) {
      res = await app.request(`http://localhost/${group}?help=true`, { method: "GET" })
    }

    const text = res.ok ? await res.text() : HELP
    process.stdout.write(`${text}\n`)
    process.exit(0)
  }

  const res = await app.request(url, { method })

  if (!res.ok) {
    const text = await res.text()
    if (text) process.stderr.write(`${text}\n`)
    process.exit(1)
  }

  const body = await res.text()

  if (body) process.stdout.write(`${body}\n`)
}
