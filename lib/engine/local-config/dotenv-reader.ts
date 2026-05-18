import { join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { LOCAL_ENV_FILENAME } from "@/engine/local-config/local-config-schema"

type Deps = {
  fs: FunnelFileSystem
}

const VARIABLE_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/

const unquote = (value: string): string => {
  if (value.length < 2) return value

  const first = value[0]
  const last = value[value.length - 1]

  if (first === '"' && last === '"') return value.slice(1, -1)
  if (first === "'" && last === "'") return value.slice(1, -1)

  return value
}

/**
 * Minimal `.env.local` parser. Supports `KEY=value` lines, blank lines, and
 * `#` comments. Strips matching surrounding single or double quotes. No
 * interpolation, no `export` prefix — anything fancier should live in a real
 * env file loaded by the shell.
 */
export class FunnelDotenvReader {
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps) {
    this.fs = deps.fs
    Object.freeze(this)
  }

  read(cwd: string): Record<string, string> {
    const path = join(cwd, LOCAL_ENV_FILENAME)

    if (!this.fs.existsSync(path)) return {}

    const raw = this.fs.readFileSync(path)
    const out: Record<string, string> = {}

    for (const line of raw.split("\n")) {
      const trimmed = line.trim()

      if (trimmed === "" || trimmed.startsWith("#")) continue

      const match = trimmed.match(VARIABLE_LINE)

      if (!match) continue

      const key = match[1]
      const value = match[2]

      if (!key) continue

      out[key] = unquote(value ?? "")
    }

    return out
  }
}
