import { FunnelCallableConnectorStore } from "@/connectors/callable-connector-store";
import type { FunnelConnectorAdapter } from "@/connectors/connector-adapter";
import type { FunnelConnectorListener } from "@/connectors/connector-listener";
import { DEFAULT_FUNNEL_DIR, FunnelJsonConnectorStore } from "@/connectors/json-connector-store";
import { FunnelSlackAdapter } from "@/connectors/slack-adapter";
import { FunnelSlackListener } from "@/connectors/slack-listener";
import {
  type SlackConnectorConfig,
  slackConnectorSchema,
} from "@/connectors/slack-connector-schema";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import type { FunnelLogger } from "@/engine/logger/logger";
import type { FunnelClock } from "@/engine/time/clock";

type Deps = {
  fs?: FunnelFileSystem;
  dir?: string;
  logger?: FunnelLogger;
  clock?: FunnelClock;
};

export type SlackUpdateFields = {
  botToken?: string;
  appToken?: string;
};

export class FunnelSlackStore extends FunnelCallableConnectorStore<SlackConnectorConfig> {
  readonly type = "slack" as const;
  private readonly store: FunnelJsonConnectorStore<SlackConnectorConfig>;
  private readonly logger?: FunnelLogger;
  private readonly clock?: FunnelClock;

  constructor(deps: Deps = {}) {
    super();
    this.store = new FunnelJsonConnectorStore<SlackConnectorConfig>({
      type: "slack",
      schema: slackConnectorSchema,
      fs: deps.fs,
      dir: deps.dir ?? DEFAULT_FUNNEL_DIR,
      secret: true,
    });
    this.logger = deps.logger;
    this.clock = deps.clock;
    Object.freeze(this);
  }

  list(): SlackConnectorConfig[] {
    return this.store.list();
  }

  get(name: string): SlackConnectorConfig | null {
    return this.store.get(name);
  }

  has(name: string): boolean {
    return this.store.has(name);
  }

  add(config: SlackConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`);

    const now = this.clock?.iso() ?? new Date().toISOString();

    this.store.write({
      ...config,
      createdAt: config.createdAt ?? now,
      updatedAt: now,
    });
  }

  update(name: string, fields: SlackUpdateFields): void {
    const current = this.store.get(name);

    if (!current) throw new Error(`connector "${name}" not found`);

    const now = this.clock?.iso() ?? new Date().toISOString();

    this.store.write({
      ...current,
      botToken: fields.botToken ?? current.botToken,
      appToken: fields.appToken ?? current.appToken,
      updatedAt: now,
    });
  }

  remove(name: string): void {
    this.store.remove(name);
  }

  rename(oldName: string, newName: string): void {
    this.store.rename(oldName, newName);
  }

  createListener(config: SlackConnectorConfig): FunnelConnectorListener {
    return new FunnelSlackListener({ config, logger: this.logger });
  }

  createAdapter(config: SlackConnectorConfig): FunnelConnectorAdapter {
    return new FunnelSlackAdapter({ config });
  }
}
