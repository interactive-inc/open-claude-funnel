#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" }
import { startChannelServer } from "@/modules/mcp/channel-server"
import { toRequest } from "@/modules/router/to-request"
import { launchTui } from "@/modules/tui/tui"
import { app } from "@/routes"

process.title = "funnel"

const HELP = `funnel — Open Claude Funnel

usage: funnel [command]

commands:
  (none)                launch TUI
  claude --channel <c>  launch Claude Code
  connectors            manage external connections (Slack, etc.)
  channels              manage subscription boxes
  agents                manage agent presets (extra)
  repos                 manage repositories (extra)
  gateway               manage the gateway
  status                show overall connection status
  mcp                   run as an MCP server (invoked from .mcp.json)

options:
  --help, -h            show help
  --version, -v         show version

more: funnel <command> --help`

const args = process.argv.slice(2)

if (args.length === 0) {
  await launchTui()
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

    if (!res.ok && method !== "GET") {
      res = await app.request(url, { method: "GET" })
    }

    if (!res.ok) {
      const group = parsed.pathname.split("/").filter(Boolean)[0]

      if (group) {
        res = await app.request(`http://localhost/${group}?help=true`, { method: "GET" })
      }
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
