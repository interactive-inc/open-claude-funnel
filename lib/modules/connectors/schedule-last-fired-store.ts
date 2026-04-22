import { dirname, join } from "node:path"
import { DEFAULT_FUNNEL_DIR } from "@/modules/connectors/funnel-json-connector-store"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"

type Deps = {
  connector: string
  fs?: FunnelFileSystem
  dir?: string
}

const defaultFs = new NodeFunnelFileSystem()

export class ScheduleLastFiredStore {
  private readonly path: string
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps) {
    this.fs = deps.fs ?? defaultFs
    const base = deps.dir ?? DEFAULT_FUNNEL_DIR
    this.path = join(base, "connectors", "schedule", `${deps.connector}.state.json`)
    Object.freeze(this)
  }

  load(): Map<string, Date> {
    if (!this.fs.existsSync(this.path)) return new Map()

    const raw = JSON.parse(this.fs.readFileSync(this.path)) as Record<string, string>
    const map = new Map<string, Date>()

    for (const [id, iso] of Object.entries(raw)) {
      map.set(id, new Date(iso))
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
