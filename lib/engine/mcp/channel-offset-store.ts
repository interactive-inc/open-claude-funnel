import { join } from "node:path"
import { z } from "zod"
import { FunnelFileSystem } from "@/engine/fs/file-system"

type Deps = {
  fs: FunnelFileSystem
  dir: string
  /** Sink for corruption warnings. Defaults to writing to process.stderr. */
  warn?: (message: string) => void
}

const offsetMapSchema = z.record(z.string(), z.number())

type OffsetMap = z.infer<typeof offsetMapSchema>

const defaultWarn = (message: string): void => {
  process.stderr.write(`${message}\n`)
}

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
  constructor(private readonly props: Deps) {
    Object.freeze(this)
  }

  get(channelId: string, cwd: string): number {
    const value = this.readMap(channelId)[cwd]

    return typeof value === "number" && value > 0 ? value : 0
  }

  /** Offsets <= 0 clear the entry so a corrupted high-water mark can be reset. */
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

    if (!this.props.fs.existsSync(path)) return {}

    const raw = this.props.fs.readFileSync(path)

    let json: unknown

    try {
      json = JSON.parse(raw)
    } catch (error) {
      this.warn(
        `funnel: corrupted offsets at ${path}: ${error instanceof Error ? error.message : String(error)}. resetting to 0`,
      )
      return {}
    }

    const parsed = offsetMapSchema.safeParse(json)

    if (!parsed.success) {
      this.warn(
        `funnel: offsets.json at ${path} did not match schema; resetting to 0`,
      )
      return {}
    }

    return parsed.data
  }

  private writeMap(channelId: string, map: OffsetMap): void {
    const path = this.pathFor(channelId)
    const channelDir = this.channelDir(channelId)

    if (!this.props.fs.existsSync(channelDir)) {
      this.props.fs.mkdirSync(channelDir, { recursive: true })
    }

    this.props.fs.writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`)
  }

  private channelDir(channelId: string): string {
    return join(this.props.dir, "channels", channelId)
  }

  private pathFor(channelId: string): string {
    return join(this.channelDir(channelId), "offsets.json")
  }

  private warn(message: string): void {
    const sink = this.props.warn ?? defaultWarn
    sink(message)
  }
}
