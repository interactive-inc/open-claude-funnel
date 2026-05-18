import { join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import {
  type LocalConfig,
  LOCAL_CONFIG_FILENAME,
  localConfigSchema,
} from "@/engine/local-config/local-config-schema"

type Deps = {
  fs: FunnelFileSystem
}

/**
 * Reads `funnel.json` from a directory. Returns `null` when the file is
 * absent so callers can fall through to other resolution paths (default
 * profile, help). Throws on present-but-invalid files so misconfiguration
 * surfaces loudly instead of silently launching the wrong channel.
 */
export class FunnelLocalConfig {
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps) {
    this.fs = deps.fs
    Object.freeze(this)
  }

  read(cwd: string): LocalConfig | null {
    const path = join(cwd, LOCAL_CONFIG_FILENAME)

    if (!this.fs.existsSync(path)) return null

    const raw = this.fs.readFileSync(path)

    const parsed = (() => {
      try {
        return JSON.parse(raw) as unknown
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${LOCAL_CONFIG_FILENAME} is not valid JSON: ${message}`)
      }
    })()

    const result = localConfigSchema.safeParse(parsed)

    if (!result.success) {
      throw new Error(`${LOCAL_CONFIG_FILENAME} is invalid: ${result.error.message}`)
    }

    return result.data
  }
}
