import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { SETTINGS_VERSION, settingsSchema } from "@/engine/settings/settings-schema"
import type { Settings } from "@/engine/settings/settings-schema"

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
        version: SETTINGS_VERSION,
        channels: [],
        profiles: [],
      }
    }

    const content = this.fs.readFileSync(this.path)
    const parsed: unknown = JSON.parse(content)

    if (this.looksLikeLegacy(parsed)) {
      throw new Error(
        `legacy settings.json detected at ${this.path}. The schema changed (channel.connectors are now nested objects with ids; profile fields renamed). Migration is intentionally not provided. Back up and remove the old file:\n  mv ${this.path} ${this.path}.bak`,
      )
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      parsed.version !== SETTINGS_VERSION
    ) {
      throw new Error(
        `unsupported settings.json version (${this.path}): expected ${SETTINGS_VERSION}, got ${String(parsed.version)}`,
      )
    }

    const result = settingsSchema.safeParse(parsed)

    if (!result.success) {
      throw new Error(
        `invalid settings.json (${this.path}): ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      )
    }

    return result.data
  }

  private looksLikeLegacy(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== "object") return false

    const obj = parsed as Record<string, unknown>

    if (Array.isArray(obj.channels)) {
      for (const channel of obj.channels) {
        if (!channel || typeof channel !== "object") continue
        const ch = channel as Record<string, unknown>

        if (Array.isArray(ch.connectors) && ch.connectors.some((x) => typeof x === "string")) {
          return true
        }

        if (!("id" in ch) && "name" in ch) return true
      }
    }

    if (Array.isArray(obj.connectors)) return true
    if (Array.isArray(obj.repositories)) return true

    if (Array.isArray(obj.profiles)) {
      for (const profile of obj.profiles) {
        if (!profile || typeof profile !== "object") continue
        const p = profile as Record<string, unknown>

        if ("repository" in p || "envFiles" in p || ("channel" in p && !("channelId" in p))) {
          return true
        }
      }
    }

    return false
  }

  write(settings: Settings): void {
    this.fs.mkdirSync(dirname(this.path), { recursive: true })
    const versioned: Settings = { ...settings, version: SETTINGS_VERSION }
    this.fs.writeFileSync(this.path, `${JSON.stringify(versioned, null, 2)}\n`)
  }
}
