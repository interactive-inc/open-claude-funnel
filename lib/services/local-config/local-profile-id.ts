import { createHash } from "node:crypto"

/**
 * Derives a filesystem-safe stable key for a named profile inside one
 * repo-scoped funnel directory.
 */
export function localProfileId(name: string): string {
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 32)

  return `local-${digest}`
}
