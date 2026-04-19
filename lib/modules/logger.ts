import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const LOG_FILE = join("/tmp/funnel", "funnel.log")

type Level = "info" | "warn" | "error"

const write = (level: Level, message: string, meta?: Record<string, unknown>) => {
  mkdirSync(dirname(LOG_FILE), { recursive: true })

  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  }

  appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`)
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
  file: LOG_FILE,
}
