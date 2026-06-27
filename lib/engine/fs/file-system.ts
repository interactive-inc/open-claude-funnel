export type FileStat = {
  mtimeMs: number
  /** POSIX mode bits (e.g. 0o600). `null` when the underlying FS does not expose mode. */
  mode: number | null
}

/**
 * Filesystem boundary used everywhere funnel reads or writes.
 * Default is NodeFunnelFileSystem (real `node:fs`); MemoryFunnelFileSystem
 * provides a sandbox for tests and embedded use.
 */
export abstract class FunnelFileSystem {
  abstract existsSync(path: string): boolean
  abstract readFileSync(path: string): string
  abstract writeFileSync(path: string, data: string): void
  /** Write `data` and ensure the resulting file is owner-only (0600). Use for tokens and any file that may contain secrets. */
  abstract writeSecretFileSync(path: string, data: string): void
  abstract appendFileSync(path: string, data: string): void
  abstract unlink(path: string): void
  abstract mkdirSync(path: string, options?: { recursive?: boolean }): void
  abstract readdirSync(path: string): string[]
  abstract statSync(path: string): FileStat
  /**
   * Run `fn` while holding an exclusive lock on `lockPath`. The lock file is
   * created atomically (`O_EXCL`) so two processes cannot both enter. A stale
   * lock whose owning pid is no longer alive is forcibly broken (this is what
   * keeps a SIGKILL'd CLI command from wedging the lock forever). The Memory
   * impl is a no-op because tests are single-threaded.
   */
  abstract withFileLock<T>(lockPath: string, fn: () => T): T
}
