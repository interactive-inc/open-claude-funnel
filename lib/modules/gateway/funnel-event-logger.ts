import { join } from "node:path"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

type Deps = {
  logDir: string
  fs?: FunnelFileSystem
  now?: () => number
}

const defaultFs = new NodeFunnelFileSystem()

export class FunnelEventLogger {
  private readonly logDir: string
  private readonly fs: FunnelFileSystem
  private readonly now: () => number

  constructor(deps: Deps) {
    this.logDir = deps.logDir
    this.fs = deps.fs ?? defaultFs
    this.now = deps.now ?? (() => Date.now())
    this.fs.mkdirSync(this.logDir, { recursive: true })
    this.rotate()
    Object.freeze(this)
  }

  log(content: string, meta?: Record<string, string>): void {
    const entry = {
      timestamp: new Date(this.now()).toISOString(),
      eventType: meta?.event_type ?? "unknown",
      content: content.length > 2000 ? `${content.slice(0, 2000)}...` : content,
      meta,
    }
    const dateStr = new Date(this.now()).toISOString().slice(0, 10)
    const logFile = join(this.logDir, `${dateStr}.jsonl`)

    this.fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`)
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
