import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
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

  withFileLock<T>(lockPath: string, fn: () => T): T {
    const fd = acquireLock(lockPath)
    try {
      return fn()
    } finally {
      try {
        closeSync(fd)
      } catch {
        // ignore — best-effort release
      }
      try {
        unlinkSync(lockPath)
      } catch {
        // ignore — the lock file may already be gone if another process
        // broke a stale lock and rewrote it. The semantic invariant
        // (we held the lock during fn()) is preserved either way.
      }
    }
  }
}

const LOCK_RETRY_BASE_MS = 10
const LOCK_RETRY_MAX_MS = 100
const LOCK_TIMEOUT_MS = 5_000
const LOCK_STALE_AFTER_MS = 30_000

/**
 * Acquire an exclusive lock by atomically creating `lockPath` (`O_EXCL`).
 * Retries with bounded backoff up to LOCK_TIMEOUT_MS. If the existing lock
 * file is older than LOCK_STALE_AFTER_MS or owned by a dead pid, break it
 * and try again. The pid is written to the lock file so the staleness check
 * can be precise (mtime alone is fooled by clock jumps).
 */
const acquireLock = (lockPath: string): number => {
  const deadline = performance.now() + LOCK_TIMEOUT_MS
  let attempt = 0

  while (true) {
    try {
      const fd = openSync(lockPath, "wx", 0o600)
      writeFileSync(fd, String(process.pid))
      return fd
    } catch (error) {
      if (!isErrnoCode(error, "EEXIST")) throw error

      if (performance.now() >= deadline) {
        throw new Error(`failed to acquire file lock ${lockPath} within ${LOCK_TIMEOUT_MS}ms`)
      }

      breakIfStale(lockPath)

      const wait = Math.min(LOCK_RETRY_MAX_MS, LOCK_RETRY_BASE_MS * 2 ** Math.min(attempt, 4))
      sleepSyncMs(wait)
      attempt = attempt + 1
    }
  }
}

const breakIfStale = (lockPath: string): void => {
  let pid: number
  let mtimeMs: number

  try {
    const stat = statSync(lockPath)
    mtimeMs = stat.mtimeMs
    pid = Number(readFileSync(lockPath, "utf-8").trim())
  } catch {
    return
  }

  const ageMs = Date.now() - mtimeMs

  if (ageMs > LOCK_STALE_AFTER_MS) {
    try {
      unlinkSync(lockPath)
    } catch {
      // race with another breaker — fine, retry path will see EEXIST again
    }
    return
  }

  if (pid > 0 && !isPidAlive(pid)) {
    try {
      unlinkSync(lockPath)
    } catch {
      // race with another breaker — fine
    }
  }
}

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isErrnoCode(error, "EPERM")) return true
    return false
  }
}

/**
 * Sleep synchronously for `ms` by spinning on Atomics.wait against a private
 * SharedArrayBuffer. Required because the lock acquisition path is itself
 * synchronous (every settings-mutating call site is sync) and cannot await.
 * The spin is bounded by LOCK_RETRY_MAX_MS so total wall time stays low.
 */
const sleepSyncMs = (ms: number): void => {
  const sab = new SharedArrayBuffer(4)
  const view = new Int32Array(sab)
  Atomics.wait(view, 0, 0, ms)
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
