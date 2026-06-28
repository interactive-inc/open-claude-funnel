import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelIdGenerator } from "@/engine/id/id-generator"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { SETTINGS_VERSION, settingsSchema } from "@/engine/settings/settings-schema"
import type { Settings } from "@/engine/settings/settings-schema"

/**
 * Resolves the funnel home dir. Defaults to `~/.funnel`, overridable via
 * `FUNNEL_DIR` so a funnel.json-scoped launch can point everything (settings,
 * gateway pid/token, claude pids) at a repo-local `<repo>/.funnel` and never
 * touch the global home. Read at call time, not module load, so a daemon
 * spawned with the env set resolves the override.
 *
 * The override goes through `expandHomeDir` so a consumer .mcp.json can write
 * `FUNNEL_DIR: "~/.nocker/funnel"` or `"${HOME}/.nocker/funnel"` and have it
 * land on the right path on macOS, Linux, and Windows — Claude Code's `${VAR}`
 * expansion only resolves whichever env happens to be set on the host shell
 * (`$HOME` is unset on vanilla Windows cmd/PowerShell, `$USERPROFILE` is unset
 * on macOS/Linux), so funnel takes the second swing here.
 */
export function resolveFunnelDir(): string {
  const override = process.env.FUNNEL_DIR

  if (override && override.length > 0) return expandHomeDir(override)

  return join(homedir(), ".funnel")
}

/**
 * Resolves the three forms a consumer might write for the user home dir:
 * a leading `~` / `~/`, the literal `${HOME}` token, and the literal
 * `${USERPROFILE}` token. The expansion is intentionally narrow — only the
 * home-dir tokens are substituted, no general shell-variable expansion — so
 * an accidentally embedded `${USERPROFILE}` in a path on macOS does not
 * silently turn into a different (Windows-style) path elsewhere. Normalizes
 * Windows backslashes to forward slashes after expansion because Node's
 * `path` operations accept either on Windows but the cross-platform pieces
 * (URL building, glob matching) prefer forward slashes.
 */
export function expandHomeDir(input: string): string {
  const home = homedir()
  let result = input

  if (result === "~") return home
  if (result.startsWith("~/") || result.startsWith("~\\")) {
    result = home + result.slice(1)
  }
  result = result.split("${HOME}").join(home)
  result = result.split("${USERPROFILE}").join(home)
  return result.replace(/\\/g, "/")
}

export const DEFAULT_GATEWAY_PORT = 9742

/**
 * Resolves the gateway port. Defaults to 9742 — the port a programmatically
 * hosted gateway (`new Funnel().gatewayServer()`) uses. The `funnel` CLI entry
 * sets `FUNNEL_PORT` to a distinct default so a CLI launch never collides with
 * an embedding app's gateway on 9742. Read at call time so a daemon spawned
 * with the env set resolves the override.
 */
export function resolveFunnelPort(): number {
  return Number(process.env.FUNNEL_PORT) || DEFAULT_GATEWAY_PORT
}

export const FUNNEL_DIR = join(homedir(), ".funnel")
export const SETTINGS_PATH = join(FUNNEL_DIR, "settings.json")

type Deps = {
  path?: string
  fs?: FunnelFileSystem
  idGenerator?: FunnelIdGenerator
}

const defaultFs = new NodeFunnelFileSystem()
const defaultIdGenerator = new NodeFunnelIdGenerator()

export class FunnelSettingsStore extends FunnelSettingsReader {
  private readonly path: string
  private readonly fs: FunnelFileSystem
  private readonly idGenerator: FunnelIdGenerator

  constructor(deps: Deps = {}) {
    super()
    this.path = deps.path ?? SETTINGS_PATH
    this.fs = deps.fs ?? defaultFs
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator
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

    const minted = this.backfillProfileIds(parsed)

    const result = settingsSchema.safeParse(parsed)

    if (!result.success) {
      throw new Error(
        `invalid settings.json (${this.path}): ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      )
    }

    // Persist backfilled ids once, on the first read of a pre-id legacy file, so
    // every later read returns the same id (mirrors FunnelLocalConfigWriter.ensureId).
    if (minted) this.write(result.data)

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

  /**
   * Non-destructive migration for profiles written before `id` existed. Mints a
   * uuid for each profile lacking one and returns whether anything was minted, so
   * `read` can persist it immediately — a profile id must be STABLE across reads,
   * otherwise `setSessionId` (a second read) sees a different id and can't match
   * the one the launch used. Mutates `parsed` in place (freshly JSON-parsed).
   */
  private backfillProfileIds(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== "object") return false

    const obj = parsed as Record<string, unknown>

    if (!Array.isArray(obj.profiles)) return false

    let minted = false

    for (const profile of obj.profiles) {
      if (!profile || typeof profile !== "object") continue
      const p = profile as Record<string, unknown>

      if (typeof p.id !== "string") {
        p.id = this.idGenerator.generate()
        minted = true
      }
    }

    return minted
  }

  write(settings: Settings): void {
    this.fs.mkdirSync(dirname(this.path), { recursive: true })
    const versioned: Settings = { ...settings, version: SETTINGS_VERSION }
    // settings.json inlines live connector tokens (Slack/Discord bot tokens),
    // so it must be owner-only (0600) like gateway.token — never world-readable.
    this.fs.writeSecretFileSync(this.path, `${JSON.stringify(versioned, null, 2)}\n`)
  }

  /**
   * Run `mutator` against a freshly-read settings object inside an exclusive
   * file lock, then persist the result. Use this instead of bare `read()` +
   * `write()` for any logical edit (add channel, set token, rename profile),
   * so two concurrent CLI invocations or `fnl claude` launches cannot lose
   * each other's updates via a read-modify-write race. The mutator may
   * mutate `settings` in place and/or return a value; the value is returned
   * to the caller. A thrown error from the mutator skips the write but still
   * releases the lock.
   */
  update<T>(mutator: (settings: Settings) => T): T {
    this.fs.mkdirSync(dirname(this.path), { recursive: true })
    return this.fs.withFileLock(`${this.path}.lock`, () => {
      const settings = this.read()
      const result = mutator(settings)
      this.write(settings)
      return result
    })
  }
}
