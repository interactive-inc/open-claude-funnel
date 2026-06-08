import type { FunnelTextLevel, FunnelTextEntry } from "@/logger/funnel-text-entry"
import type { FunnelTextWriter } from "@/logger/funnel-text-writer"

type WriteErrorHandler = (error: Error, record: FunnelTextEntry) => void

type Props = {
  /** Where records go. Use `FunnelTextStdoutWriter`, `FunnelTextFileWriter`, or your own. */
  writer: FunnelTextWriter
  /** Minimum level to emit. Lower-rank records are dropped. Default: "info". */
  level?: FunnelTextLevel
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number
  /** Observer for writer failures. Default: silently swallow. */
  onWriteError?: WriteErrorHandler
}

const LEVEL_RANK: Record<FunnelTextLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
}

/**
 * Human-facing diagnostic logger. The companion to `FunnelLog`: where
 * `FunnelLog` is for schema-validated, replayable domain events,
 * `FunnelTextLog` is for free-form info/warn/error messages destined
 * for a human tailing a log or skimming during incident response.
 *
 * Keeping the two separate matters operationally:
 *   - Diagnostics typically out-volume domain events 10–1000x; mixing
 *     them in the same store would push events out under retention.
 *   - Diagnostics are unstructured by design; mixing them in would defeat
 *     the schema-first guarantee that makes domain events replayable.
 *   - Different audiences and queries (humans grep `tail -f` vs. tools
 *     query `WHERE seq > ?`).
 *
 * The writer is a port. Level gating happens here so writers receive only
 * what is worth persisting. Failure isolation matches `FunnelLog`: a
 * writer that throws or returns Error is contained, surfaced via
 * `onWriteError`, and never blocks the caller.
 */
export class FunnelTextLog {
  private readonly writer: FunnelTextWriter
  private readonly minRank: number
  private readonly now: () => number
  private readonly onWriteError: WriteErrorHandler | null

  constructor(props: Props) {
    this.writer = props.writer
    this.minRank = LEVEL_RANK[props.level ?? "info"]
    this.now = props.now ?? (() => Date.now())
    this.onWriteError = props.onWriteError ?? null
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.emit("info", message, meta)
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit("warn", message, meta)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.emit("error", message, meta)
  }

  close(): void {
    if (!this.writer.close) return
    try {
      this.writer.close()
    } catch {
      // close failures are best-effort by definition
    }
  }

  private emit(level: FunnelTextLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < this.minRank) return

    const record: FunnelTextEntry = {
      ts: this.now(),
      level,
      message,
      meta: meta ?? null,
    }

    const error = this.callWriter(record)
    if (error && this.onWriteError) this.onWriteError(error, record)
  }

  private callWriter(record: FunnelTextEntry): Error | null {
    try {
      const outcome = this.writer.write(record)
      return outcome instanceof Error ? outcome : null
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e))
    }
  }
}
