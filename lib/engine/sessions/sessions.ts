import { join } from "node:path"
import { z } from "zod"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { FunnelIdGenerator } from "@/engine/id/id-generator"

type Deps = {
  fs: FunnelFileSystem
  idGenerator: FunnelIdGenerator
  dir: string
}

const sessionsMapSchema = z.record(z.string(), z.string())

type SessionsMap = z.infer<typeof sessionsMapSchema>

/**
 * Per-channel persistent Claude Code session IDs, keyed by the cwd the
 * channel was launched from. The whole point is to give each (channel, cwd)
 * its own stable conversation: relaunching from the same path resumes the
 * previous claude session via `--resume <uuid>`, while a different cwd (or
 * a different channel) gets an independent one — so sessions never silently
 * bleed across workspaces the way claude's `-c` does.
 *
 * `get` and `create` are intentionally separate: claude's `--session-id`
 * only accepts a fresh UUID (it errors if the session jsonl already
 * exists), so callers must check `get` first and fall back to `create`
 * only when there is nothing to resume.
 *
 * Storage lives under `<dir>/channels/<channel-id>/sessions.json` (channel
 * id, not name, so renames don't lose history). The file is a flat
 * `{ cwd: uuid }` map; the channel directory itself is created lazily.
 */
export class FunnelSessions {
  private readonly fs: FunnelFileSystem
  private readonly idGenerator: FunnelIdGenerator
  private readonly dir: string

  constructor(deps: Deps) {
    this.fs = deps.fs
    this.idGenerator = deps.idGenerator
    this.dir = deps.dir
    Object.freeze(this)
  }

  /** Returns the existing session id for (channelId, cwd) or null. */
  get(channelId: string, cwd: string): string | null {
    return this.readMap(channelId)[cwd] ?? null
  }

  /** Generates a new session id for (channelId, cwd) and persists it, overwriting any prior entry. */
  create(channelId: string, cwd: string): string {
    const map = this.readMap(channelId)
    const sessionId = this.idGenerator.generate()

    map[cwd] = sessionId
    this.writeMap(channelId, map)

    return sessionId
  }

  /** Drops the recorded session id for (channelId, cwd). No-op if absent. */
  clear(channelId: string, cwd: string): void {
    const map = this.readMap(channelId)

    if (!(cwd in map)) return

    delete map[cwd]
    this.writeMap(channelId, map)
  }

  /** Drops the whole session map for the channel (e.g. when the channel is deleted). */
  clearAll(channelId: string): void {
    const path = this.pathFor(channelId)

    if (this.fs.existsSync(path)) this.fs.unlink(path)
  }

  private readMap(channelId: string): SessionsMap {
    const path = this.pathFor(channelId)

    if (!this.fs.existsSync(path)) return {}

    const raw = this.fs.readFileSync(path)

    try {
      const parsed = sessionsMapSchema.safeParse(JSON.parse(raw))

      return parsed.success ? parsed.data : {}
    } catch {
      return {}
    }
  }

  private writeMap(channelId: string, map: SessionsMap): void {
    const path = this.pathFor(channelId)
    const channelDir = this.channelDir(channelId)

    if (!this.fs.existsSync(channelDir)) {
      this.fs.mkdirSync(channelDir, { recursive: true })
    }

    this.fs.writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`)
  }

  private channelDir(channelId: string): string {
    return join(this.dir, "channels", channelId)
  }

  private pathFor(channelId: string): string {
    return join(this.channelDir(channelId), "sessions.json")
  }
}
