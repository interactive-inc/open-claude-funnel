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
    // Atomic write via temp + rename for every file the funnel persists.
    // Even non-secret config (schedule state.json, funnel.json id backfill)
    // becomes unreadable if a SIGKILL or power loss truncates the JSON, and
    // every funnel write is small — the extra rename cost is well below the
    // recovery cost of a hand-edit.
    atomicWrite(path, data, null)
  }

  writeSecretFileSync(path: string, data: string): void {
    // settings.json inlines live Slack / Discord bot tokens; chmod 0600 in
    // addition to atomic write so a non-owner cannot read the file even
    // mid-write (the temp file is also created with the secret mode).
    atomicWrite(path, data, SECRET_MODE)
  }

  appendFileSync(path: string, data: string): void {
    appendFileSync(path, data)
  }

  unlink(path: string): void {
    try {
      unlinkSync(path)
    } catch (error) {
      // ENOENT is the documented "remove if exists" semantic — silent OK.
      // Any other error (EACCES, EPERM, EBUSY on Windows) means the file
      // still exists. Swallowing those silently lets stale PID files,
      // stale lock files, and stale token files survive a "delete" call,
      // which has produced confusing "daemon already running" / "stale
      // session" reports in the past. Surface them.
      if (isErrnoCode(error, "ENOENT")) return
      throw error
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

/**
 * Narrow `unknown` to a Node errno-typed error and check whether its `code`
 * matches the expected value. Avoids `as NodeJS.ErrnoException` casts at
 * each call site while still letting callers distinguish ENOENT / EACCES /
 * etc. without falling back to message-string matching.
 */
const isErrnoCode = (error: unknown, code: string): boolean => {
  if (!(error instanceof Error)) return false
  if (!("code" in error)) return false
  return error.code === code
}

/**
 * Atomic write via temp + rename. `rename(2)` is atomic on POSIX when source
 * and target share a filesystem, which is guaranteed because the temp file
 * lives in the same directory as the target. A failed write unlinks the
 * temp file so we do not leak `.foo.json.<pid>.tmp` leftovers.
 *
 * `mode` controls the perm bits on both temp and final file. Pass `null` for
 * the OS default (umask-derived), or `0o600` for secret-bearing files.
 */
const atomicWrite = (path: string, data: string, mode: number | null): void => {
  const dir = dirname(path)
  const tempPath = `${dir}/.${basename(path)}.${nextTempSuffix()}.tmp`
  const writeOptions = mode === null ? undefined : { mode }

  try {
    writeFileSync(tempPath, data, writeOptions)

    if (mode !== null) {
      try {
        chmodSync(tempPath, mode)
      } catch {
        // best-effort tightening; rename still wins so we keep going
      }
    }

    renameSync(tempPath, path)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      // ignore — best-effort cleanup
    }
    throw error
  }
}
