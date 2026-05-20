import { join } from "node:path"
import { z } from "zod"
import { FunnelFileSystem } from "@/engine/fs/file-system"

type Deps = {
  fs: FunnelFileSystem
  dir: string
}

const offsetMapSchema = z.record(z.string(), z.number())

type OffsetMap = z.infer<typeof offsetMapSchema>

/**
 * Per-(channel, cwd) persistent broadcaster offset for MCP subscribers. The
 * MCP child re-spawns on every Claude Code restart and would otherwise lose
 * its in-memory `lastOffset`, falling back to "no since" and missing every
 * event broadcast before the new socket opens. Persisting the offset closes
 * that gap: on startup the subscriber loads the last seen offset and asks the
 * gateway to replay `?since=<offset>` from the SQLite event store.
 *
 * Storage lives under `<dir>/channels/<channel-id>/offsets.json` (channel id,
 * not name, so renames don't lose history) and is shaped as a flat
 * `{ cwd: offset }` map — the same shape FunnelSessions uses for session ids,
 * so multiple Claude instances launched from different repos don't clobber
 * each other.
 */
export class FunnelChannelOffsetStore {
  private readonly fs: FunnelFileSystem
  private readonly dir: string

  constructor(deps: Deps) {
    this.fs = deps.fs
    this.dir = deps.dir
    Object.freeze(this)
  }

  /** Returns the last persisted offset for (channelId, cwd) or 0. */
  get(channelId: string, cwd: string): number {
    const value = this.readMap(channelId)[cwd]

    return typeof value === "number" && value > 0 ? value : 0
  }

  /** Persists `offset` for (channelId, cwd). Offsets <= 0 clear the entry. */
  set(channelId: string, cwd: string, offset: number): void {
    const map = this.readMap(channelId)

    if (offset > 0) {
      map[cwd] = offset
    } else {
      delete map[cwd]
    }

    this.writeMap(channelId, map)
  }

  private readMap(channelId: string): OffsetMap {
    const path = this.pathFor(channelId)

    if (!this.fs.existsSync(path)) return {}

    const raw = this.fs.readFileSync(path)

    try {
      const parsed = offsetMapSchema.safeParse(JSON.parse(raw))

      return parsed.success ? parsed.data : {}
    } catch {
      return {}
    }
  }

  private writeMap(channelId: string, map: OffsetMap): void {
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
    return join(this.channelDir(channelId), "offsets.json")
  }
}
