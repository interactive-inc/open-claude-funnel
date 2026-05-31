import { join } from "node:path"
import { FunnelIdGenerator } from "@/engine/id/id-generator"
import { FunnelLocalConfig } from "@/engine/local-config/local-config"
import { FunnelLocalConfigWriter } from "@/engine/local-config/local-config-writer"

type Deps = {
  localConfig: FunnelLocalConfig
  writer: FunnelLocalConfigWriter
  idGenerator: FunnelIdGenerator
  home: string
}

/**
 * Resolves the funnel home dir for a cwd. When the cwd has a funnel.json, every
 * byte of funnel state is scoped to `~/.funnel/projects/<id>/` so the repo holds
 * no settings or tokens; the id comes from funnel.json, or is generated and
 * written back on the first launch. Returns null when there is no funnel.json,
 * leaving the caller on the global `~/.funnel`. Setting this as FUNNEL_DIR before
 * building Funnel makes every path (CLI routing, dispatchClaude, TUI, MCP, the
 * spawned daemon) resolve to the same scoped root.
 */
export const resolveRepoDir = (deps: Deps, cwd: string): string | null => {
  const local = deps.localConfig.read(cwd)

  if (!local) return null

  if (local.id !== undefined && local.id !== "") {
    return join(deps.home, ".funnel", "projects", local.id)
  }

  const id = deps.idGenerator.generate()

  deps.writer.ensureId(cwd, id)

  return join(deps.home, ".funnel", "projects", id)
}
