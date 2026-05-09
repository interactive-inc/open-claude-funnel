import { dirname } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"

type Deps = {
  path: string
  fs?: FunnelFileSystem
}

const defaultFs = new NodeFunnelFileSystem()

/**
 * Per-connector lastFiredAt persistence for the schedule listener. The path is
 * passed in by FunnelConnectorFactory so this store does not know about the
 * funnel directory layout (`channels/<id>/connectors/<id>/state.json` lives
 * outside this class).
 */
export class ScheduleStateStore {
  private readonly path: string
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps) {
    this.path = deps.path
    this.fs = deps.fs ?? defaultFs
    Object.freeze(this)
  }

  load(): Map<string, Date> {
    const map = new Map<string, Date>()

    if (!this.fs.existsSync(this.path)) return map

    const raw: unknown = JSON.parse(this.fs.readFileSync(this.path))

    if (raw === null || typeof raw !== "object") return map

    for (const [id, iso] of Object.entries(raw)) {
      if (typeof iso === "string") map.set(id, new Date(iso))
    }

    return map
  }

  save(state: Map<string, Date>): void {
    const obj: Record<string, string> = {}

    for (const [id, date] of state) {
      obj[id] = date.toISOString()
    }

    this.fs.mkdirSync(dirname(this.path), { recursive: true })
    this.fs.writeFileSync(this.path, `${JSON.stringify(obj, null, 2)}\n`)
  }
}
