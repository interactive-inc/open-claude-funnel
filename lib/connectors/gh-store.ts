import { FunnelCallableConnectorStore } from "@/connectors/callable-connector-store";
import type { FunnelConnectorAdapter } from "@/connectors/connector-adapter";
import type { FunnelConnectorListener } from "@/connectors/connector-listener";
import { DEFAULT_FUNNEL_DIR, FunnelJsonConnectorStore } from "@/connectors/json-connector-store";
import { FunnelGhAdapter } from "@/connectors/gh-adapter";
import { FunnelGhListener } from "@/connectors/gh-listener";
import { type GhConnectorConfig, ghConnectorSchema } from "@/connectors/gh-connector-schema";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import type { FunnelLogger } from "@/engine/logger/logger";
import type { FunnelProcessRunner } from "@/engine/process/process-runner";
import type { FunnelClock } from "@/engine/time/clock";

type Deps = {
  fs?: FunnelFileSystem;
  dir?: string;
  process?: FunnelProcessRunner;
  logger?: FunnelLogger;
  clock?: FunnelClock;
};

export type GhUpdateFields = {
  pollInterval?: number;
};

export class FunnelGhStore extends FunnelCallableConnectorStore<GhConnectorConfig> {
  readonly type = "gh" as const;
  private readonly store: FunnelJsonConnectorStore<GhConnectorConfig>;
  private readonly process?: FunnelProcessRunner;
  private readonly logger?: FunnelLogger;
  private readonly clock?: FunnelClock;

  constructor(deps: Deps = {}) {
    super();
    this.store = new FunnelJsonConnectorStore<GhConnectorConfig>({
      type: "gh",
      schema: ghConnectorSchema,
      fs: deps.fs,
      dir: deps.dir ?? DEFAULT_FUNNEL_DIR,
    });
    this.process = deps.process;
    this.logger = deps.logger;
    this.clock = deps.clock;
    Object.freeze(this);
  }

  list(): GhConnectorConfig[] {
    return this.store.list();
  }

  get(name: string): GhConnectorConfig | null {
    return this.store.get(name);
  }

  has(name: string): boolean {
    return this.store.has(name);
  }

  add(config: GhConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`);

    const now = this.clock?.iso() ?? new Date().toISOString();

    this.store.write({
      ...config,
      createdAt: config.createdAt ?? now,
      updatedAt: now,
    });
  }

  update(name: string, fields: GhUpdateFields): void {
    const current = this.store.get(name);

    if (!current) throw new Error(`connector "${name}" not found`);

    const now = this.clock?.iso() ?? new Date().toISOString();

    this.store.write({
      ...current,
      pollInterval: fields.pollInterval ?? current.pollInterval,
      updatedAt: now,
    });
  }

  remove(name: string): void {
    this.store.remove(name);
  }

  rename(oldName: string, newName: string): void {
    this.store.rename(oldName, newName);
  }

  createListener(config: GhConnectorConfig): FunnelConnectorListener {
    const clock = this.clock;

    return new FunnelGhListener({
      config,
      process: this.process,
      logger: this.logger,
      now: clock ? () => clock.now() : undefined,
    });
  }

  createAdapter(_config: GhConnectorConfig): FunnelConnectorAdapter {
    return new FunnelGhAdapter();
  }
}
