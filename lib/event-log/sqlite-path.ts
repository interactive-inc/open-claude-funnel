/** Match Bun's filename trimming before filesystem checks, directory creation or chmod. */
export function normalizeSqlitePath(path: string): string {
  return path.trim()
}
