import { join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { LOCAL_CONFIG_FILENAME } from "@/services/local-config/local-config-schema"

type Deps = {
  fs: FunnelFileSystem
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Rebuilds the object with `$schema` then `id` up front, preserving every other
// key in its original order (channels, profiles, and any future additions). The
// repo-committed funnel.json should read top-down with the identity first.
const withIdFirst = (config: Record<string, unknown>, id: string): Record<string, unknown> => {
  const ordered: Record<string, unknown> = {}

  if (config.$schema !== undefined) ordered.$schema = config.$schema

  ordered.id = id

  for (const key of Object.keys(config)) {
    if (key === "$schema" || key === "id") continue
    ordered[key] = config[key]
  }

  return ordered
}

/**
 * The one path that mutates the repo-committed funnel.json, and it only ever
 * inserts `id`. On first launch a repo has no `id`; funnel generates one and
 * writes it back here so future launches resolve the same `~/.funnel/projects/<id>/`.
 * Idempotent — a no-op once `id` is present. Kept separate from the read-only
 * FunnelLocalConfig so reads stay side-effect free.
 */
export class FunnelLocalConfigWriter {
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps) {
    this.fs = deps.fs
    Object.freeze(this)
  }

  ensureId(cwd: string, id: string): void {
    const path = join(cwd, LOCAL_CONFIG_FILENAME)

    if (!this.fs.existsSync(path)) return

    const parsed = JSON.parse(this.fs.readFileSync(path)) as unknown

    if (!isRecord(parsed)) return

    if (typeof parsed.id === "string" && parsed.id !== "") return

    const ordered = withIdFirst(parsed, id)

    this.fs.writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`)
  }
}
