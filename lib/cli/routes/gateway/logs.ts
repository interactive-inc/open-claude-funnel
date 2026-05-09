import { readdirSync } from "node:fs"
import { join } from "node:path"
import { stringify } from "yaml"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/gateway/logs.help"

const logger = new NodeFunnelLogger()

type LogEntry = {
  timestamp: string
  eventType: string
  meta?: unknown
  content: string
}

const tryParseJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

const isLogEntry = (value: unknown): value is LogEntry => {
  if (value === null || typeof value !== "object") return false
  if (!("timestamp" in value) || typeof value.timestamp !== "string") return false
  if (!("eventType" in value) || typeof value.eventType !== "string") return false
  if (!("content" in value) || typeof value.content !== "string") return false

  return true
}

export const gatewayLogsHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      n: z.string().optional(),
    }),
    help,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const logDir = funnel.gateway.getLogDir()

    const files = readdirSync(logDir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()

    if (files.length === 0) {
      return c.text("no logs")
    }

    const latestFile = join(logDir, files[files.length - 1]!)
    const lineCount = query.n ? Number(query.n) : 20

    const tail = Bun.spawn(["tail", "-f", "-n", String(lineCount), latestFile], {
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

    logger.info("gateway.logs tail start", { file: latestFile })

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

        const parsedContent = tryParseJson(parsed.content) ?? parsed.content
        const output = {
          time: parsed.timestamp,
          type: parsed.eventType,
          ...(parsed.meta ? { meta: parsed.meta } : {}),
          content: parsedContent,
        }

        process.stdout.write(`---\n${stringify(output)}`)
      }
    }

    await tail.exited
    process.exit(0)
  },
)
