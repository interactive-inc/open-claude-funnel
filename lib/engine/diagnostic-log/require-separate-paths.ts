import { lstatSync, realpathSync, statSync } from "node:fs"
import { dirname, join, parse, sep } from "node:path"

/** Reject shared files before any diagnostic store can migrate or write them. */
export function requireSeparateDiagnosticPaths(paths: readonly string[]): void {
  const names = new Set<string>()
  const files = new Set<string>()
  for (const path of paths) {
    if (path === ":memory:") continue
    const canonical = canonicalPath(path)
    if (names.has(canonical))
      throw new Error("diagnostic database paths must identify separate files")
    names.add(canonical)
    try {
      const stat = statSync(canonical, { bigint: true })
      const identity = `${stat.dev}:${stat.ino}`
      if (files.has(identity))
        throw new Error("diagnostic database paths must identify separate files")
      files.add(identity)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
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
