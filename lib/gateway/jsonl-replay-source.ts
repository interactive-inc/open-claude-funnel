import { join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import type { ReplayableEvent } from "@/gateway/broadcaster"

const DEFAULT_FILE_LIMIT = 7
const DEFAULT_MAX_EVENTS = 1000

type Deps = {
  /** System-wide daily-rotated log directory (gateway lifecycle). */
  logDir: string
  /** Funnel home dir; per-connector logs live under <funnelDir>/channels/<id>/connectors/<id>/logs.jsonl. */
  funnelDir?: string
  fs?: FunnelFileSystem
  /** Cap on how many days of system jsonl files we scan during replay. Default 7. */
  fileLimit?: number
  /** Cap on how many events we return from a single replay request. Default 1000. */
  maxEvents?: number
}

type LoggedEntry = {
  offset: number | null
  content: string
  meta?: Record<string, string>
}

const defaultFs = new NodeFunnelFileSystem()

/**
 * Reads persisted events from the gateway's jsonl event log to support replay across
 * daemon restarts. The in-memory ring buffer in `FunnelBroadcaster` covers short reconnects;
 * this source covers gaps that span a daemon restart, where the in-memory buffer is empty
 * but the on-disk log still has events with offsets > the client's `since`.
 *
 * Only events that were written with an `offset` (i.e., emitted via the broadcaster, not
 * system-only entries like `gateway_start`) are eligible for replay.
 */
export class JsonlReplaySource {
  private readonly logDir: string
  private readonly funnelDir: string | null
  private readonly fs: FunnelFileSystem
  private readonly fileLimit: number
  private readonly maxEvents: number

  constructor(deps: Deps) {
    this.logDir = deps.logDir
    this.funnelDir = deps.funnelDir ?? null
    this.fs = deps.fs ?? defaultFs
    this.fileLimit = Math.max(1, deps.fileLimit ?? DEFAULT_FILE_LIMIT)
    this.maxEvents = Math.max(1, deps.maxEvents ?? DEFAULT_MAX_EVENTS)
    Object.freeze(this)
  }

  /** Returns the maximum offset found across the most recent jsonl files, or 0 if none. */
  findMaxOffset(): number {
    let max = 0

    for (const file of this.recentFiles()) {
      for (const entry of this.iterEntries(file)) {
        if (entry.offset !== null && entry.offset > max) max = entry.offset
      }
    }

    return max
  }

  /**
   * Loads events with offset > since across the recent jsonl files, sorted ascending by offset.
   * Caller is responsible for connector-subscription filtering.
   */
  loadSince(since: number): ReplayableEvent[] {
    const collected: ReplayableEvent[] = []

    for (const file of this.recentFiles()) {
      for (const entry of this.iterEntries(file)) {
        if (entry.offset === null || entry.offset <= since) continue

        collected.push({
          content: entry.content,
          meta: entry.meta,
          offset: entry.offset,
        })

        if (collected.length >= this.maxEvents) break
      }

      if (collected.length >= this.maxEvents) break
    }

    collected.sort((a, b) => a.offset - b.offset)

    return collected
  }

  private recentFiles(): string[] {
    const files: string[] = []

    if (this.fs.existsSync(this.logDir)) {
      const names = this.fs
        .readdirSync(this.logDir)
        .filter((n) => n.endsWith(".jsonl"))
        .sort()
      const tail = names.slice(-this.fileLimit)

      for (const name of tail) files.push(join(this.logDir, name))
    }

    files.push(...this.connectorLogFiles())

    return files
  }

  private connectorLogFiles(): string[] {
    if (!this.funnelDir) return []

    const channelsDir = join(this.funnelDir, "channels")

    if (!this.fs.existsSync(channelsDir)) return []

    const out: string[] = []

    for (const channelId of this.fs.readdirSync(channelsDir)) {
      const connectorsDir = join(channelsDir, channelId, "connectors")

      if (!this.fs.existsSync(connectorsDir)) continue

      for (const connectorId of this.fs.readdirSync(connectorsDir)) {
        const path = join(connectorsDir, connectorId, "logs.jsonl")

        if (this.fs.existsSync(path)) out.push(path)
      }
    }

    return out
  }

  private *iterEntries(path: string): IterableIterator<LoggedEntry> {
    if (!this.fs.existsSync(path)) return

    const content = this.fs.readFileSync(path)
    const lines = content.split("\n")

    for (const line of lines) {
      if (line.trim().length === 0) continue

      try {
        const parsed = JSON.parse(line)

        if (typeof parsed !== "object" || parsed === null) continue
        if (typeof parsed.content !== "string") continue

        yield {
          offset: typeof parsed.offset === "number" ? parsed.offset : null,
          content: parsed.content,
          meta: parsed.meta,
        }
      } catch {
        // skip unparseable lines
      }
    }
  }
}
