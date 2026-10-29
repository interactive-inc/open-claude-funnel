import { normalizeSqlitePath } from "@/event-log/sqlite-path"
import { lstatSync, realpathSync, statSync } from "node:fs"
import { dirname, join, parse, sep } from "node:path"

/** Reject shared files before any diagnostic store can migrate or write them. */
export function requireSeparateDiagnosticPaths(paths: readonly string[]): void {
  const names = new Map<string, string>()
  const files = new Map<string, string>()
  const reserve = (path: string, owner: string): void => {
    const canonical = canonicalPath(path)
    const previous = names.get(canonical)
    if (previous !== undefined && previous !== owner)
      throw new Error("diagnostic database paths must identify separate files")
    names.set(canonical, owner)
    try {
      const stat = statSync(canonical, { bigint: true })
      const identity = `${stat.dev}:${stat.ino}`
      const previousFile = files.get(identity)
      if (previousFile !== undefined && previousFile !== owner)
        throw new Error("diagnostic database paths must identify separate files")
      files.set(identity, owner)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  paths.forEach((input, index) => {
    const path = normalizeSqlitePath(input)
    if (path === ":memory:") return
    const canonical = canonicalPath(path)
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      // Reserve both the caller's spelling and the resolved database name:
      // SQLite sidecars must not overwrite any other store's primary file.
      const owner = `${index}:${suffix}`
      reserve(`${path}${suffix}`, owner)
      reserve(`${canonical}${suffix}`, owner)
    }
  })
}

function canonicalPath(path: string): string {
  const root = parse(path).root
  let current = realpathSync(root || process.cwd())
  // Resolve each existing component before applying a later parent traversal.
  // Some runtimes normalize .. before realpath, which loses symlink semantics.
  const parts = path.slice(root.length).split(sep === "\\" ? /[\\/]/ : /\//)
  for (const part of parts) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      current = dirname(current)
      continue
    }
    const candidate = join(current, part)
    try {
      current = realpathSync(candidate)
    } catch (error) {
      if (!isMissing(error)) throw error
      // An unresolved file symlink must not bypass the physical-file check.
      try {
        if (lstatSync(candidate).isSymbolicLink())
          throw new Error("diagnostic database paths must not contain dangling symbolic links")
      } catch (failure) {
        if (!isMissing(failure)) throw failure
      }
      current = candidate
    }
  }
  return current
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
