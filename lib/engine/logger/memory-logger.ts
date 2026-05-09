import { FunnelLogger } from "@/engine/logger/logger"

export type LogEntry = {
  level: "info" | "warn" | "error"
  message: string
  meta?: Record<string, unknown>
}

export class MemoryFunnelLogger extends FunnelLogger {
  readonly file = null
  readonly entries: LogEntry[] = []

  info(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: "info", message, meta })
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: "warn", message, meta })
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: "error", message, meta })
  }

  clear(): void {
    this.entries.length = 0
  }
}
