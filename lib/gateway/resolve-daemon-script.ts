import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Locate the daemon entry script. Works in both dev (running from source)
 * and built mode (bundled into dist/bin.js with daemon at dist/gateway/daemon.js).
 *
 * The candidates cover:
 *  1. dev: this helper lives at lib/gateway/, so daemon.ts is its sibling
 *  2. built sibling: dist/gateway/daemon.js if the helper itself ends up at dist/gateway/
 *  3. bundled: when this helper is inlined into dist/bin.js, the helper's dir is dist/,
 *     and daemon.js lives at dist/gateway/daemon.js
 *
 * Uses `fileURLToPath(import.meta.url)` rather than `import.meta.dir` so the
 * same helper resolves correctly whether run from source, the built sibling,
 * or inlined into the bundle.
 */
export const resolveDaemonScript = (): string => {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, "./daemon.ts"),
    resolve(here, "./daemon.js"),
    resolve(here, "./gateway/daemon.js"),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(`daemon script not found (looked in ${candidates.join(", ")})`)
}
