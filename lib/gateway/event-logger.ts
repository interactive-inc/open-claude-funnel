import { join } from "node:path";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system";

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CONTENT_CHARS = 2000;
const DEFAULT_MAX_LINES = 1024;
const DEFAULT_TRIM_TO_LINES = 512;

type Deps = {
  logDir: string;
  fs?: FunnelFileSystem;
  now?: () => number;
  /** Hard cap on lines per daily jsonl file. When exceeded, the file is trimmed. */
  maxLines?: number;
  /** Number of most-recent lines to keep when a file is trimmed. Must be < maxLines. */
  trimToLines?: number;
};

const defaultFs = new NodeFunnelFileSystem();

/**
 * Append-only event sink for the gateway. One jsonl file per UTC day. Each daily file is
 * capped at `maxLines` (default 1024); when an append pushes a file over the cap, the
 * oldest lines are dropped and the file is rewritten with the most recent `trimToLines`
 * (default 512) entries. The hysteresis between the two limits means the truncation cost
 * is amortized — only paid once per (maxLines - trimToLines) appends.
 *
 * Offsets are absolute (seeded via `JsonlReplaySource.findMaxOffset()` at startup), so
 * trimming oldest lines is safe for replay; clients asking `?since=<offset>` for a value
 * older than what survives in any file simply get no replay back.
 */
export class FunnelEventLogger {
  private readonly logDir: string;
  private readonly fs: FunnelFileSystem;
  private readonly now: () => number;
  private readonly maxLines: number;
  private readonly trimToLines: number;
  private readonly lineCounts: Map<string, number> = new Map();

  constructor(deps: Deps) {
    this.logDir = deps.logDir;
    this.fs = deps.fs ?? defaultFs;
    this.now = deps.now ?? (() => Date.now());
    this.maxLines = Math.max(1, deps.maxLines ?? DEFAULT_MAX_LINES);
    this.trimToLines = Math.max(0, Math.min(this.maxLines - 1, deps.trimToLines ?? DEFAULT_TRIM_TO_LINES));
    this.fs.mkdirSync(this.logDir, { recursive: true });
    this.rotate();
    Object.freeze(this);
  }

  log(content: string, meta?: Record<string, string>, offset?: number): void {
    const entry = {
      offset: offset ?? null,
      timestamp: new Date(this.now()).toISOString(),
      eventType: meta?.event_type ?? "unknown",
      content:
        content.length > MAX_CONTENT_CHARS ? `${content.slice(0, MAX_CONTENT_CHARS)}...` : content,
      meta,
    };
    const dateStr = new Date(this.now()).toISOString().slice(0, 10);
    const logFile = join(this.logDir, `${dateStr}.jsonl`);
    const previous = this.lineCounts.get(logFile) ?? this.countLines(logFile);

    this.fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);

    const next = previous + 1;

    if (next > this.maxLines) {
      this.trimFile(logFile);
      this.lineCounts.set(logFile, this.trimToLines);
    } else {
      this.lineCounts.set(logFile, next);
    }
  }

  private countLines(path: string): number {
    if (!this.fs.existsSync(path)) return 0;

    return this.fs
      .readFileSync(path)
      .split("\n")
      .filter((l) => l.length > 0).length;
  }

  private trimFile(path: string): void {
    const lines = this.fs
      .readFileSync(path)
      .split("\n")
      .filter((l) => l.length > 0);
    const kept = lines.slice(-this.trimToLines);
    const next = kept.length > 0 ? `${kept.join("\n")}\n` : "";

    this.fs.writeFileSync(path, next);
  }

  private rotate(): void {
    const now = this.now();

    for (const name of this.fs.readdirSync(this.logDir)) {
      if (!name.endsWith(".jsonl")) continue;

      const path = join(this.logDir, name);

      try {
        const stat = this.fs.statSync(path);

        if (now - stat.mtimeMs > MAX_AGE_MS) this.fs.unlink(path);
      } catch {
        // ignore
      }
    }
  }
}
