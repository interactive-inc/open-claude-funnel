import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, basename } from "node:path"
import { type FileStat, FunnelFileSystem } from "@/engine/fs/file-system"

const SECRET_MODE = 0o600

/**
 * Random suffix for the temp file used by the atomic write path. Cannot use
 * crypto.randomUUID directly because Bun spec restricts where it works; a
 * pid+counter pair is enough for in-process uniqueness, which is all we need
 * (the temp file lives at most a few ms before rename).
 */
let tempCounter = 0
const nextTempSuffix = (): string => {
  tempCounter = (tempCounter + 1) | 0
  return `${process.pid}-${tempCounter}-${Math.floor(Math.random() * 1e9)}`
}

export class NodeFunnelFileSystem extends FunnelFileSystem {
  constructor() {
    super()
    Object.freeze(this)
  }

  existsSync(path: string): boolean {
    return existsSync(path)
  }

  readFileSync(path: string): string {
    return readFileSync(path, "utf-8")
  }

  writeFileSync(path: string, data: string): void {
    writeFileSync(path, data)
  }

  writeSecretFileSync(path: string, data: string): void {
    // Atomic write via temp + rename. settings.json holds Slack / Discord
    // bot tokens — a SIGKILL or power loss mid-write would otherwise truncate
    // it to empty or partial JSON and the daemon would refuse to start until
    // the operator hand-restored from backup (which may not exist). rename
    // is atomic on POSIX when source and destination share a filesystem,
    // which is guaranteed because the temp file sits next to the target.
    const dir = dirname(path)
    const tempPath = `${dir}/.${basename(path)}.${nextTempSuffix()}.tmp`

    try {
      writeFileSync(tempPath, data, { mode: SECRET_MODE })
      try {
        chmodSync(tempPath, SECRET_MODE)
      } catch {
        // best-effort tightening; rename still wins so we keep going
      }
      renameSync(tempPath, path)
    } catch (error) {
      // Clean up the temp file on any failure so we do not litter the
      // settings directory with `.settings.json.NNN.tmp` leftovers.
      try {
        unlinkSync(tempPath)
      } catch {
        // ignore — best-effort
      }
      throw error
    }
  }

  appendFileSync(path: string, data: string): void {
    appendFileSync(path, data)
  }

  unlink(path: string): void {
    try {
      unlinkSync(path)
    } catch {
      // ignore
    }
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    mkdirSync(path, { recursive: options?.recursive ?? false })
  }

  readdirSync(path: string): string[] {
    return readdirSync(path)
  }

  statSync(path: string): FileStat {
    const stat = statSync(path)

    return { mtimeMs: stat.mtimeMs, mode: stat.mode & 0o777 }
  }
}
