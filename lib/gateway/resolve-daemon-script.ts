import { existsSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Locate the daemon entry script. Works in both dev (running from source)
 * and built mode (bundled into dist/bin.js with daemon at dist/gateway/daemon.js).
 *
 * The candidates cover:
 *  1. dev: this helper lives at lib/gateway/, so daemon.ts is its sibling
 *  2. built sibling: dist/gateway/daemon.js if the helper itself ends up at dist/gateway/
 *  3. bundled: when this helper is inlined into dist/bin.js, import.meta.dir is dist/,
 *     and daemon.js lives at dist/gateway/daemon.js
 */
export const resolveDaemonScript = (): string => {
  const candidates = [
    resolve(import.meta.dir, "./daemon.ts"),
    resolve(import.meta.dir, "./daemon.js"),
    resolve(import.meta.dir, "./gateway/daemon.js"),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(`daemon script not found (looked in ${candidates.join(", ")})`)
}
