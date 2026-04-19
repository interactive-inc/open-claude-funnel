import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"
import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import { settingsSchema } from "@/modules/settings/settings-schema"
import type { Settings } from "@/modules/settings/settings-schema"

export const FUNNEL_DIR = join(homedir(), ".funnel")
export const SETTINGS_PATH = join(FUNNEL_DIR, "settings.json")

type Deps = {
  path?: string
  fs?: FunnelFileSystem
}

const defaultFs = new NodeFunnelFileSystem()

export class FunnelSettingsStore extends FunnelSettingsReader {
  private readonly path: string
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps = {}) {
    super()
    this.path = deps.path ?? SETTINGS_PATH
    this.fs = deps.fs ?? defaultFs
    Object.freeze(this)
  }

  read(): Settings {
    if (!this.fs.existsSync(this.path)) {
      return {
        connectors: [],
        channels: [],
        repositories: [],
        agents: [],
      }
    }

    const content = this.fs.readFileSync(this.path)
    const parsed = JSON.parse(content)
    const result = settingsSchema.safeParse(parsed)

    if (!result.success) {
      throw new Error(
        `invalid settings.json (${this.path}): ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      )
    }

    return result.data
  }

  write(settings: Settings): void {
    this.fs.mkdirSync(dirname(this.path), { recursive: true })
    this.fs.writeFileSync(this.path, `${JSON.stringify(settings, null, 2)}\n`)
  }
}
