import { z } from "zod";
import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener";
import { FunnelLogger } from "@/engine/logger/logger";
import { NodeFunnelLogger } from "@/engine/logger/node-logger";
import { FunnelProcessRunner } from "@/engine/process/process-runner";
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner";
import type { GhConnectorConfig } from "@/connectors/gh-connector-schema";

const ghNotificationSchema = z.object({
  id: z.string(),
  reason: z.string(),
  subject: z.object({
    type: z.string(),
    url: z.string(),
    title: z.string(),
  }),
  repository: z.object({ full_name: z.string() }),
  updated_at: z.string(),
});

const ghNotificationsSchema = z.array(ghNotificationSchema);

type GhNotification = z.infer<typeof ghNotificationSchema>;

type Deps = {
  config: GhConnectorConfig;
  process?: FunnelProcessRunner;
  logger?: FunnelLogger;
  now?: () => Date;
};

const defaultProcess = new NodeFunnelProcessRunner();
const defaultLogger = new NodeFunnelLogger();

const MAX_SEEN = 10000;
const KEEP_SEEN = 5000;

export class FunnelGhListener extends FunnelConnectorListener {
  private readonly config: GhConnectorConfig;
  private readonly process: FunnelProcessRunner;
  private readonly logger: FunnelLogger;
  private readonly now: () => Date;
  private readonly seen = new Map<string, string>();
  private bootstrapped = false;
  private since: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: Deps) {
    super();
    this.config = deps.config;
    this.process = deps.process ?? defaultProcess;
    this.logger = deps.logger ?? defaultLogger;
    this.now = deps.now ?? (() => new Date());
    this.since = this.now().toISOString();
  }

  async start(notify: NotifyFn): Promise<void> {
    await this.pollOnce(notify);

    const interval = this.config.pollInterval ?? 60;

    this.timer = setInterval(() => void this.pollOnce(notify), interval * 1000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (!this.timer) return;

    clearInterval(this.timer);
    this.timer = null;
  }

  override isAlive(): boolean {
    return this.timer !== null;
  }

  async pollOnce(notify: NotifyFn): Promise<void> {
    const nextSince = this.now().toISOString();
    const params = new URLSearchParams({ since: this.since, all: "false" });

    try {
      const result = await this.process.run(["gh", "api", `/notifications?${params}`]);

      if (result.exitCode !== 0) {
        this.logger.error("gh poll failed", { stderr: result.stderr });
        return;
      }

      const parsed = ghNotificationsSchema.safeParse(JSON.parse(result.stdout));

      if (!parsed.success) {
        this.logger.warn("gh response did not match schema", { error: parsed.error.message });
        return;
      }

      const items: GhNotification[] = parsed.data;

      for (const item of items) {
        if (this.seen.get(item.id) === item.updated_at) continue;

        this.seen.set(item.id, item.updated_at);

        if (!this.bootstrapped) continue;

        const meta: Record<string, string> = {
          event_type: "gh",
          reason: item.reason,
          subject_type: item.subject.type,
          subject_url: item.subject.url,
          repository: item.repository.full_name,
          thread_id: item.id,
          updated_at: item.updated_at,
        };

        await notify(JSON.stringify(item), meta);
      }

      if (this.seen.size > MAX_SEEN) {
        const toDrop = this.seen.size - KEEP_SEEN;
        let dropped = 0;

        for (const key of this.seen.keys()) {
          if (dropped >= toDrop) break;
          this.seen.delete(key);
          dropped++;
        }
      }

      this.since = nextSince;
      this.bootstrapped = true;
    } catch (error) {
      this.logger.error("gh poll error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
