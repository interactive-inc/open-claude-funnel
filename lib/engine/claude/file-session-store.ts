import { dirname, join } from "node:path"
import { z } from "zod"
import type { SessionStore } from "@/engine/claude/session-store"
import { sessionFileExists } from "@/engine/claude/session-file-exists"
import type { FunnelFileSystem } from "@/engine/fs/file-system"

const sessionIdsSchema = z.record(z.string(), z.string())

type Deps = {
  fs: FunnelFileSystem
  dir: string
}

/**
 * Session-id store for repo-local funnel.json profiles, isolated from the
 * global profile list while remaining stable across launches.
 */
export class FunnelFileSessionStore implements SessionStore {
  private readonly fs: FunnelFileSystem
  private readonly path: string

  constructor(deps: Deps) {
    this.fs = deps.fs
    this.path = join(deps.dir, "claude", "local-sessions.json")
    Object.freeze(this)
  }

  getSessionId(profileId: string): string | null {
    this.fs.mkdirSync(dirname(this.path), { recursive: true })

    return this.fs.withFileLock(`${this.path}.lock`, () => this.read()[profileId] ?? null)
  }

  setSessionId(profileId: string, sessionId: string): void {
    this.fs.mkdirSync(dirname(this.path), { recursive: true })
    this.fs.withFileLock(`${this.path}.lock`, () => {
      const sessionIds = this.read()

      sessionIds[profileId] = sessionId
      this.fs.writeFileSync(this.path, `${JSON.stringify(sessionIds, null, 2)}\n`)
    })
  }

  sessionFileExists(cwd: string, sessionId: string, env: Record<string, string>): boolean {
    return sessionFileExists({ fs: this.fs, cwd, sessionId, env })
  }

  private read(): Record<string, string> {
    if (!this.fs.existsSync(this.path)) return {}

    const parsed: unknown = JSON.parse(this.fs.readFileSync(this.path))
    const sessionIds = sessionIdsSchema.safeParse(parsed)

    if (!sessionIds.success) {
      throw new Error(`invalid local profile session store (${this.path})`)
    }

    return sessionIds.data
  }
}
