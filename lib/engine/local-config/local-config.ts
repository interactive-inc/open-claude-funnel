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

    this.assertProfilesValid(result.data)

    return result.data
  }

  // Cross-field checks the schema can't express: a profile must bind a declared
  // channel, and only the first profile per channel is ever applied. Both
  // failure modes are otherwise silent (the recipe just never reaches claude),
  // so reject them loudly at load time.
  private assertProfilesValid(config: LocalConfig): void {
    const profiles = config.profiles ?? []

    if (profiles.length === 0) return

    const channelNames = new Set(config.channels.map((channel) => channel.name))
    const boundChannels = new Set<string>()

    for (const profile of profiles) {
      if (!channelNames.has(profile.channel)) {
        throw new Error(
          `${LOCAL_CONFIG_FILENAME} is invalid: profile "${profile.name}" binds channel "${profile.channel}", which is not declared in channels[]`,
        )
      }

      if (boundChannels.has(profile.channel)) {
        throw new Error(
          `${LOCAL_CONFIG_FILENAME} is invalid: channel "${profile.channel}" has more than one profile; only the first is applied — remove the extras`,
        )
      }

      boundChannels.add(profile.channel)
    }
  }
}
