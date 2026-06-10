import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { FunnelLogger } from "@/engine/logger/logger"
import { redactSecrets } from "@/engine/logger/redact-secrets"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"

const defaultLogFile = (): string => join(funnelTmpDir(), "funnel.log")

type Level = "info" | "warn" | "error"

type Props = {
  file?: string
  now?: () => Date
}

export class NodeFunnelLogger extends FunnelLogger {
  readonly file: string
  private readonly now: () => Date

  constructor(props: Props = {}) {
    super()
    this.file = props.file ?? defaultLogFile()
    this.now = props.now ?? (() => new Date())
    Object.freeze(this)
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write("info", message, meta)
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("warn", message, meta)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write("error", message, meta)
  }

  private write(level: Level, message: string, meta?: Record<string, unknown>): void {
    mkdirSync(dirname(this.file), { recursive: true })

    const entry = {
      time: this.now().toISOString(),
      level,
      message,
      ...(meta ? { meta } : {}),
    }

    // Redact on the serialized line so secrets are caught wherever they hide —
    // message text, nested meta values, or stringified error payloads alike.
    appendFileSync(this.file, `${redactSecrets(JSON.stringify(entry))}\n`)
  }
}
