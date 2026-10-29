/** Match Bun's trimming and validate an explicit filesystem or memory destination before I/O. */
export function normalizeSqlitePath(path: string): string {
  const normalized = path.trim()
  if (normalized === "") throw new TypeError("SQLite path must not be empty")
  if (normalized.includes("\0")) throw new TypeError("SQLite path must not contain null bytes")
  if (normalized.startsWith("file:"))
    throw new TypeError("SQLite URI paths are not supported; use a filesystem path or :memory:")
  return normalized
}
