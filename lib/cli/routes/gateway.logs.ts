import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"

const logsHelp = `funnel gateway logs — tail the daemon diagnostic log

usage: funnel gateway logs [-n <N>] [--format <plain|json>]

options:
  -n <N>                number of trailing lines to show (default: 20)
  --format <plain|json> output format (default: plain)

Streams ${join(funnelTmpDir(), "funnel.log")} — the daemon's diagnostic stream covering
gateway lifecycle, listener start/stop/error, and WebSocket connect/disconnect.
Exit with Ctrl-C.

plain format:  HH:MM:SS LEVEL  message               key=value ...
json format:   raw JSON lines (pipe to jq for filtering)

This log does NOT contain inbound Slack/connector events. For those, use:
  fnl gateway sql --preset recent      last 20 processed events
  fnl debug --channel <name>           per-channel diagnosis with outcome summary

examples:
  funnel gateway logs
  funnel gateway logs -n 100
  funnel gateway logs --format json | jq 'select(.level == "error")'

see also: fnl debug, fnl gateway sql

programmable: this command tails a file directly. For structured introspection,
              prefer funnel.diagnostics.diagnoseAll() / .recentEvents() in code.`

const logger = new NodeFunnelLogger()

type LogEntry = {
  time: string
  level: string
  message: string
  meta?: unknown
}

const tryParseJson = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

const isLogEntry = (value: unknown): value is LogEntry => {
  if (value === null || typeof value !== "object") return false
  if (!("time" in value) || typeof value.time !== "string") return false
  if (!("level" in value) || typeof value.level !== "string") return false
  if (!("message" in value) || typeof value.message !== "string") return false

  return true
}

const formatMetaValue = (value: unknown): string => {
  const str = typeof value === "string" ? value : JSON.stringify(value)

  return str.includes(" ") ? `"${str}"` : str
}

const formatMeta = (meta: unknown): string => {
  if (meta === null || typeof meta !== "object") return ""

  const pairs = Object.entries(meta as Record<string, unknown>)
    .map(([k, v]) => `${k}=${formatMetaValue(v)}`)
    .join(" ")

  return pairs ? ` ${pairs}` : ""
}

const formatPlain = (entry: LogEntry): string => {
  const time = entry.time.slice(11, 19)
  const level = entry.level.toUpperCase().padEnd(5)
  const message = entry.message.padEnd(30)
  const meta = formatMeta(entry.meta)

  return `${time} ${level} ${message}${meta}\n`
}

export const gatewayLogsHandler = factory.createHandlers(
  helpGuard(logsHelp),
  zValidator(
    "query",
    z.object({
      n: z.string().optional(),
      format: z.enum(["plain", "json"]).optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const path = logger.file

    if (!path || !existsSync(path)) {
      return c.text("no logs")
    }

    const lineCount = query.n ? Number(query.n) : 20
    const format = query.format ?? "plain"

    const tail = Bun.spawn(["tail", "-f", "-n", String(lineCount), path], {
      stdout: "pipe",
      stderr: "inherit",
    })

    const forward = (signal: "SIGINT" | "SIGTERM") => {
      tail.kill(signal)
    }

    process.on("SIGINT", () => forward("SIGINT"))
    process.on("SIGTERM", () => forward("SIGTERM"))

    const reader = tail.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const result = await reader.read()

      if (result.done) break

      buffer += decoder.decode(result.value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue

        const parsed = tryParseJson(line)

        if (!isLogEntry(parsed)) {
          process.stdout.write(`${line}\n`)
          continue
        }

        if (format === "json") {
          process.stdout.write(`${JSON.stringify(parsed)}\n`)
        } else {
          process.stdout.write(formatPlain(parsed))
        }
      }
    }

    await tail.exited
    process.exit(0)
  },
)
