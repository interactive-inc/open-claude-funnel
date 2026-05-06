import { FunnelCallableConnectorStore } from "@/connectors/callable-connector-store";
import type { FunnelConnectorAdapter } from "@/connectors/connector-adapter";
import type { FunnelConnectorListener } from "@/connectors/connector-listener";
import { DEFAULT_FUNNEL_DIR, FunnelJsonConnectorStore } from "@/connectors/json-connector-store";
import { FunnelDiscordAdapter } from "@/connectors/discord-adapter";
import { FunnelDiscordListener } from "@/connectors/discord-listener";
import {
  type DiscordConnectorConfig,
  discordConnectorSchema,
} from "@/connectors/discord-connector-schema";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import type { FunnelLogger } from "@/engine/logger/logger";
import type { FunnelClock } from "@/engine/time/clock";

type Deps = {
  fs?: FunnelFileSystem;
  dir?: string;
  logger?: FunnelLogger;
  clock?: FunnelClock;
};

export type DiscordUpdateFields = {
  botToken?: string;
};

export class FunnelDiscordStore extends FunnelCallableConnectorStore<DiscordConnectorConfig> {
  readonly type = "discord" as const;
  private readonly store: FunnelJsonConnectorStore<DiscordConnectorConfig>;
  private readonly logger?: FunnelLogger;
  private readonly clock?: FunnelClock;

  constructor(deps: Deps = {}) {
    super();
    this.store = new FunnelJsonConnectorStore<DiscordConnectorConfig>({
      type: "discord",
      schema: discordConnectorSchema,
      fs: deps.fs,
      dir: deps.dir ?? DEFAULT_FUNNEL_DIR,
      secret: true,
    });
    this.logger = deps.logger;
    this.clock = deps.clock;
    Object.freeze(this);
  }

  list(): DiscordConnectorConfig[] {
    return this.store.list();
  }

  get(name: string): DiscordConnectorConfig | null {
    return this.store.get(name);
  }

  has(name: string): boolean {
    return this.store.has(name);
  }

  add(config: DiscordConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`);

    const now = this.clock?.iso() ?? new Date().toISOString();

    this.store.write({
      ...config,
      createdAt: config.createdAt ?? now,
      updatedAt: now,
    });
  }

  update(name: string, fields: DiscordUpdateFields): void {
    const current = this.store.get(name);

    if (!current) throw new Error(`connector "${name}" not found`);

    const now = this.clock?.iso() ?? new Date().toISOString();

    this.store.write({
      ...current,
      botToken: fields.botToken ?? current.botToken,
      updatedAt: now,
    });
  }

  remove(name: string): void {
    this.store.remove(name);
  }

  rename(oldName: string, newName: string): void {
    this.store.rename(oldName, newName);
  }

  createListener(config: DiscordConnectorConfig): FunnelConnectorListener {
    return new FunnelDiscordListener({ config, logger: this.logger });
  }

  createAdapter(config: DiscordConnectorConfig): FunnelConnectorAdapter {
    return new FunnelDiscordAdapter({ config });
  }
}
