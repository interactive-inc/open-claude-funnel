import { existsSync } from "node:fs"
import { stringify } from "yaml"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/gateway/logs.help"

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
    const path = logger.file

    if (!path || !existsSync(path)) {
      return c.text("no logs")
    }

    const lineCount = query.n ? Number(query.n) : 20

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

    logger.info("gateway.logs tail start", { file: path })

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

        const output = {
          time: parsed.time,
          level: parsed.level,
          message: parsed.message,
          ...(parsed.meta ? { meta: parsed.meta } : {}),
        }

        process.stdout.write(`---\n${stringify(output)}`)
      }
    }

    await tail.exited
    process.exit(0)
  },
)
