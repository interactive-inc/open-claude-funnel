import { join } from "node:path";
import type { FunnelConnectorListener } from "@/connectors/connector-listener";
import { FunnelConnectorTypeStore } from "@/connectors/connector-type-store";
import { DEFAULT_FUNNEL_DIR } from "@/connectors/json-connector-store";
import { FunnelScheduleListener } from "@/connectors/schedule-listener";
import { ScheduleLastFiredStore } from "@/connectors/schedule-last-fired-store";
import {
  type ScheduleConnectorConfig,
  type ScheduleEntry,
  scheduleEntrySchema,
} from "@/connectors/schedule-connector-schema";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system";
import { FunnelIdGenerator } from "@/engine/id/id-generator";
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator";
import { FunnelLogger } from "@/engine/logger/logger";
import { NodeFunnelLogger } from "@/engine/logger/node-logger";
import type { FunnelClock } from "@/engine/time/clock";

type Deps = {
  fs?: FunnelFileSystem;
  dir?: string;
  logger?: FunnelLogger;
  idGenerator?: FunnelIdGenerator;
  clock?: FunnelClock;
};

type Meta = {
  createdAt?: string;
  updatedAt?: string;
};

const defaultFs = new NodeFunnelFileSystem();
const defaultLogger = new NodeFunnelLogger();
const defaultIdGenerator = new NodeFunnelIdGenerator();

export class FunnelScheduleStore extends FunnelConnectorTypeStore<ScheduleConnectorConfig> {
  readonly type = "schedule" as const;
  private readonly fs: FunnelFileSystem;
  private readonly baseDir: string;
  private readonly dir: string;
  private readonly logger: FunnelLogger;
  private readonly idGenerator: FunnelIdGenerator;
  private readonly clock?: FunnelClock;

  constructor(deps: Deps = {}) {
    super();
    this.fs = deps.fs ?? defaultFs;
    this.baseDir = deps.dir ?? DEFAULT_FUNNEL_DIR;
    this.dir = join(this.baseDir, "connectors", "schedule");
    this.logger = deps.logger ?? defaultLogger;
    this.idGenerator = deps.idGenerator ?? defaultIdGenerator;
    this.clock = deps.clock;
    Object.freeze(this);
  }

  list(): ScheduleConnectorConfig[] {
    if (!this.fs.existsSync(this.dir)) return [];

    const files = this.fs.readdirSync(this.dir).filter((f) => f.endsWith(".jsonl"));
    const configs: ScheduleConnectorConfig[] = [];

    for (const file of files) {
      const name = file.slice(0, -6);
      const config = this.get(name);

      if (config) configs.push(config);
    }

    return configs;
  }

  get(name: string): ScheduleConnectorConfig | null {
    const path = this.pathFor(name);

    if (!this.fs.existsSync(path)) return null;

    const meta = this.readMeta(name);

    return {
      type: "schedule",
      name,
      entries: this.readEntries(name),
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }

  has(name: string): boolean {
    return this.fs.existsSync(this.pathFor(name));
  }

  add(config: ScheduleConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`);

    this.fs.mkdirSync(this.dir, { recursive: true });
    const lines = config.entries.map((e) => JSON.stringify(e)).join("\n");
    this.fs.writeFileSync(this.pathFor(config.name), lines ? `${lines}\n` : "");

    const now = this.clock?.iso() ?? new Date().toISOString();
    this.writeMeta(config.name, {
      createdAt: config.createdAt ?? now,
      updatedAt: now,
    });
  }

  remove(name: string): void {
    if (!this.has(name)) throw new Error(`connector "${name}" not found`);

    this.fs.unlink(this.pathFor(name));
    this.fs.unlink(this.statePathFor(name));
    this.fs.unlink(this.metaPathFor(name));
  }

  rename(oldName: string, newName: string): void {
    if (!this.has(oldName)) throw new Error(`connector "${oldName}" not found`);
    if (this.has(newName)) throw new Error(`connector "${newName}" already exists`);

    const content = this.fs.readFileSync(this.pathFor(oldName));
    this.fs.writeFileSync(this.pathFor(newName), content);
    this.fs.unlink(this.pathFor(oldName));

    if (this.fs.existsSync(this.statePathFor(oldName))) {
      const state = this.fs.readFileSync(this.statePathFor(oldName));
      this.fs.writeFileSync(this.statePathFor(newName), state);
      this.fs.unlink(this.statePathFor(oldName));
    }

    if (this.fs.existsSync(this.metaPathFor(oldName))) {
      const meta = this.fs.readFileSync(this.metaPathFor(oldName));
      this.fs.writeFileSync(this.metaPathFor(newName), meta);
      this.fs.unlink(this.metaPathFor(oldName));
    }
  }

  addEntry(
    name: string,
    entry: Pick<ScheduleEntry, "cron" | "prompt"> &
      Partial<Pick<ScheduleEntry, "id" | "enabled" | "catchupPolicy">>,
  ): ScheduleEntry {
    if (!this.has(name)) throw new Error(`connector "${name}" not found`);

    const full: ScheduleEntry = {
      id: entry.id ?? this.idGenerator.generate(),
      cron: entry.cron,
      prompt: entry.prompt,
      enabled: entry.enabled ?? true,
      catchupPolicy: entry.catchupPolicy ?? "latest",
    };

    this.fs.appendFileSync(this.pathFor(name), `${JSON.stringify(full)}\n`);
    this.bumpUpdatedAt(name);

    return full;
  }

  removeEntry(name: string, id: string): void {
    const entries = this.readEntries(name);
    const next = entries.filter((e) => e.id !== id);

    if (next.length === entries.length) throw new Error(`schedule entry "${id}" not found`);

    const content = next.map((e) => JSON.stringify(e)).join("\n");
    this.fs.writeFileSync(this.pathFor(name), content ? `${content}\n` : "");
    this.bumpUpdatedAt(name);
  }

  createListener(config: ScheduleConnectorConfig): FunnelConnectorListener {
    const clock = this.clock;

    return new FunnelScheduleListener({
      config,
      store: this,
      lastFiredStore: this.createLastFiredStore(config.name),
      logger: this.logger,
      now: clock ? () => clock.now() : undefined,
    });
  }

  private createLastFiredStore(name: string): ScheduleLastFiredStore {
    return new ScheduleLastFiredStore({ connector: name, fs: this.fs, dir: this.baseDir });
  }

  private pathFor(name: string): string {
    return join(this.dir, `${name}.jsonl`);
  }

  private statePathFor(name: string): string {
    return join(this.dir, `${name}.state.json`);
  }

  private metaPathFor(name: string): string {
    return join(this.dir, `${name}.meta.json`);
  }

  private readMeta(name: string): Meta {
    const path = this.metaPathFor(name);

    if (!this.fs.existsSync(path)) return {};

    try {
      const parsed = JSON.parse(this.fs.readFileSync(path)) as Meta;

      return parsed;
    } catch {
      return {};
    }
  }

  private writeMeta(name: string, meta: Meta): void {
    this.fs.mkdirSync(this.dir, { recursive: true });
    this.fs.writeFileSync(this.metaPathFor(name), `${JSON.stringify(meta, null, 2)}\n`);
  }

  private bumpUpdatedAt(name: string): void {
    const now = this.clock?.iso() ?? new Date().toISOString();
    const meta = this.readMeta(name);

    this.writeMeta(name, {
      createdAt: meta.createdAt ?? now,
      updatedAt: now,
    });
  }

  private readEntries(name: string): ScheduleEntry[] {
    const path = this.pathFor(name);

    if (!this.fs.existsSync(path)) return [];

    const content = this.fs.readFileSync(path);
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const entries: ScheduleEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNumber = i + 1;

      try {
        const parsed = JSON.parse(line);
        const result = scheduleEntrySchema.safeParse(parsed);

        if (!result.success) {
          this.logger.warn("skipping invalid schedule entry", {
            connector: name,
            line: lineNumber,
            issues: result.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`),
          });
          continue;
        }

        entries.push(result.data);
      } catch (error) {
        this.logger.warn("skipping unparseable schedule entry", {
          connector: name,
          line: lineNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return entries;
  }
}
