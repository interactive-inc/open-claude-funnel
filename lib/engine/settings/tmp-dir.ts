import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Resolves the funnel temp/log root for the current OS. Defaults to
 * `<os.tmpdir()>/funnel` so Windows lands under `%TEMP%\funnel` and POSIX
 * lands under `/tmp/funnel`. Callers may override via `FUNNEL_TMP_DIR`.
 */
export function funnelTmpDir(): string {
  const override = process.env.FUNNEL_TMP_DIR

  if (override && override.length > 0) return override

  return join(tmpdir(), "funnel")
}
