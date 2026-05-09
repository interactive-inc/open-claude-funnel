import { join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_CONTENT_CHARS = 2000
const DEFAULT_MAX_LINES = 1024
const DEFAULT_TRIM_TO_LINES = 512

type Deps = {
  /** Daily-rotated system log directory (gateway start/stop, tap connects). */
  logDir: string
  /** Funnel home dir (~/.funnel by default). Channel and connector logs land under <funnelDir>/channels/<id>/... */
  funnelDir?: string
  fs?: FunnelFileSystem
  now?: () => number
  /** Hard cap on lines per per-file jsonl. When exceeded, the file is trimmed. */
  maxLines?: number
  /** Number of most-recent lines to keep when a file is trimmed. Must be < maxLines. */
  trimToLines?: number
}

const defaultFs = new NodeFunnelFileSystem()

/**
 * Append-only event sink for the gateway with three buckets:
 *
 *   - system: `<logDir>/<UTC-date>.jsonl` — daily-rotated, used for gateway-lifecycle
 *     events (start/stop, tap-all clients) where there is no owning channel.
 *   - per-channel: `<funnelDir>/channels/<channelId>/logs.jsonl` — channel
 *     subscribe/unsubscribe events for one channel.
 *   - per-connector: `<funnelDir>/channels/<channelId>/connectors/<connectorId>/logs.jsonl`
 *     — outbound events emitted by that connector's listener.
 *
 * Every file is line-capped (`maxLines`, default 1024) with hysteresis trimming down to
 * `trimToLines` (default 512). Offsets stored in connector logs are absolute and survive
 * trimming because broadcaster seeds its counter from the max offset across all files.
 */
export class FunnelEventLogger {
  private readonly logDir: string
  private readonly funnelDir: string | null
  private readonly fs: FunnelFileSystem
  private readonly now: () => number
  private readonly maxLines: number
  private readonly trimToLines: number
  private readonly lineCounts: Map<string, number> = new Map()

  constructor(deps: Deps) {
    this.logDir = deps.logDir
    this.funnelDir = deps.funnelDir ?? null
    this.fs = deps.fs ?? defaultFs
    this.now = deps.now ?? (() => Date.now())
    this.maxLines = Math.max(1, deps.maxLines ?? DEFAULT_MAX_LINES)
    this.trimToLines = Math.max(
      0,
      Math.min(this.maxLines - 1, deps.trimToLines ?? DEFAULT_TRIM_TO_LINES),
    )
    this.fs.mkdirSync(this.logDir, { recursive: true })
    this.rotate()
    Object.freeze(this)
  }

  log(content: string, meta?: Record<string, string>, offset?: number): void {
    const dateStr = new Date(this.now()).toISOString().slice(0, 10)
    const path = join(this.logDir, `${dateStr}.jsonl`)

    this.appendEntry(path, content, meta, offset)
  }

  logChannel(channelId: string, content: string, meta?: Record<string, string>): void {
    if (!this.funnelDir) {
      this.log(content, meta)

      return
    }

    const dir = join(this.funnelDir, "channels", channelId)
    const path = join(dir, "logs.jsonl")

    this.fs.mkdirSync(dir, { recursive: true })
    this.appendEntry(path, content, meta)
  }

  logConnector(
    channelId: string,
    connectorId: string,
    content: string,
    meta?: Record<string, string>,
    offset?: number,
  ): void {
    if (!this.funnelDir) {
      this.log(content, meta, offset)

      return
    }

    const dir = join(this.funnelDir, "channels", channelId, "connectors", connectorId)
    const path = join(dir, "logs.jsonl")

    this.fs.mkdirSync(dir, { recursive: true })
    this.appendEntry(path, content, meta, offset)
  }

  private appendEntry(
    path: string,
    content: string,
    meta?: Record<string, string>,
    offset?: number,
  ): void {
    const entry = {
      offset: offset ?? null,
      timestamp: new Date(this.now()).toISOString(),
      eventType: meta?.event_type ?? "unknown",
      content:
        content.length > MAX_CONTENT_CHARS ? `${content.slice(0, MAX_CONTENT_CHARS)}...` : content,
      meta,
    }
    const previous = this.lineCounts.get(path) ?? this.countLines(path)

    this.fs.appendFileSync(path, `${JSON.stringify(entry)}\n`)

    const next = previous + 1

    if (next > this.maxLines) {
      this.trimFile(path)
      this.lineCounts.set(path, this.trimToLines)
    } else {
      this.lineCounts.set(path, next)
    }
  }

  private countLines(path: string): number {
    if (!this.fs.existsSync(path)) return 0

    return this.fs
      .readFileSync(path)
      .split("\n")
      .filter((l) => l.length > 0).length
  }

  private trimFile(path: string): void {
    const lines = this.fs
      .readFileSync(path)
      .split("\n")
      .filter((l) => l.length > 0)
    const kept = lines.slice(-this.trimToLines)
    const next = kept.length > 0 ? `${kept.join("\n")}\n` : ""

    this.fs.writeFileSync(path, next)
  }

  private rotate(): void {
    const now = this.now()

    for (const name of this.fs.readdirSync(this.logDir)) {
      if (!name.endsWith(".jsonl")) continue

      const path = join(this.logDir, name)

      try {
        const stat = this.fs.statSync(path)

        if (now - stat.mtimeMs > MAX_AGE_MS) this.fs.unlink(path)
      } catch {
        // ignore
      }
    }
  }
}
