import { dirname, join } from "node:path";
import { DEFAULT_FUNNEL_DIR } from "@/connectors/json-connector-store";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system";

type Deps = {
  connector: string;
  fs?: FunnelFileSystem;
  dir?: string;
};

const defaultFs = new NodeFunnelFileSystem();

export class ScheduleLastFiredStore {
  private readonly path: string;
  private readonly fs: FunnelFileSystem;

  constructor(deps: Deps) {
    this.fs = deps.fs ?? defaultFs;
    const base = deps.dir ?? DEFAULT_FUNNEL_DIR;
    this.path = join(base, "connectors", "schedule", `${deps.connector}.state.json`);
    Object.freeze(this);
  }

  load(): Map<string, Date> {
    const map = new Map<string, Date>();

    if (!this.fs.existsSync(this.path)) return map;

    const raw: unknown = JSON.parse(this.fs.readFileSync(this.path));

    if (raw === null || typeof raw !== "object") return map;

    for (const [id, iso] of Object.entries(raw)) {
      if (typeof iso === "string") map.set(id, new Date(iso));
    }

    return map;
  }

  save(state: Map<string, Date>): void {
    const obj: Record<string, string> = {};

    for (const [id, date] of state) {
      obj[id] = date.toISOString();
    }

    this.fs.mkdirSync(dirname(this.path), { recursive: true });
    this.fs.writeFileSync(this.path, `${JSON.stringify(obj, null, 2)}\n`);
  }
}
