import type { ConnectorConfig } from "@/connectors/connector-config-schema";
import type { FunnelConnectorListener } from "@/connectors/connector-listener";
import { FunnelLogger } from "@/engine/logger/logger";
import { NodeFunnelLogger } from "@/engine/logger/node-logger";

export type ConnectorRegistry = {
  list(): ConnectorConfig[];
  createListenerFor(
    name: string,
  ): { config: ConnectorConfig; listener: FunnelConnectorListener } | null;
};

export type SupervisorNotify = (
  connectorName: string,
  content: string,
  meta?: Record<string, string>,
) => Promise<void>;

type RunningEntry = {
  config: ConnectorConfig;
  listener: FunnelConnectorListener;
};

type ListenerStats = {
  events: number;
  errors: number;
  failureCount: number;
  lastEventAt: string | null;
};

type Deps = {
  connectors: ConnectorRegistry;
  notify: SupervisorNotify;
  logger?: FunnelLogger;
  healthCheckIntervalMs?: number;
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultLogger = new NodeFunnelLogger();
const DEFAULT_HEALTH_INTERVAL_MS = 30_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

/**
 * Owns the running listener instances and their lifecycle.
 *
 * Lives in the gateway process and is the only place that calls
 * `listener.start()` / `listener.stop()`. The CLI mutates the connector
 * stores; the gateway then asks the supervisor to start / stop / restart
 * individual listeners by name without restarting the whole daemon.
 *
 * Periodically polls each running listener's `isAlive()` and auto-restarts
 * dead listeners with exponential backoff (1s, 2s, 4s, ... capped). Resets
 * the backoff counter on successful restart.
 */
export type ListenerEntryStatus = {
  name: string;
  type: ConnectorConfig["type"];
  alive: boolean;
  events: number;
  errors: number;
  failureCount: number;
  lastEventAt: string | null;
};

export class FunnelListenerSupervisor {
  private readonly connectors: ConnectorRegistry;
  private readonly notify: SupervisorNotify;
  private readonly logger: FunnelLogger;
  private readonly running = new Map<string, RunningEntry>();
  private readonly failureCounts = new Map<string, number>();
  private readonly stats = new Map<string, ListenerStats>();
  private readonly healthCheckIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private healthCheckInFlight = false;

  constructor(deps: Deps) {
    this.connectors = deps.connectors;
    this.notify = deps.notify;
    this.logger = deps.logger ?? defaultLogger;
    this.healthCheckIntervalMs = deps.healthCheckIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
    this.maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? (() => Date.now());
  }

  isRunning(name: string): boolean {
    return this.running.has(name);
  }

  list(): ListenerEntryStatus[] {
    return [...this.running.entries()].map(([name, entry]) => {
      const stats = this.stats.get(name);

      return {
        name,
        type: entry.config.type,
        alive: entry.listener.isAlive(),
        events: stats?.events ?? 0,
        errors: stats?.errors ?? 0,
        failureCount: this.failureCounts.get(name) ?? 0,
        lastEventAt: stats?.lastEventAt ?? null,
      };
    });
  }

  async start(name: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.running.has(name)) {
      return { ok: true, reason: "already running" };
    }

    const created = this.connectors.createListenerFor(name);

    if (!created) {
      return { ok: false, reason: `connector "${name}" not found` };
    }

    const bind = async (content: string, meta?: Record<string, string>) => {
      try {
        await this.notify(name, content, meta);
        this.recordEvent(name);
      } catch (error) {
        this.recordError(name);
        throw error;
      }
    };

    try {
      await created.listener.start(bind);
      this.running.set(name, created);
      this.ensureStats(name);
      this.logger.info(`${created.config.type} listener started`, { connector: name });

      return { ok: true };
    } catch (error) {
      this.logger.error(`${created.config.type} listener failed to start`, {
        connector: name,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private ensureStats(name: string): ListenerStats {
    const existing = this.stats.get(name);

    if (existing) return existing;

    const fresh: ListenerStats = { events: 0, errors: 0, failureCount: 0, lastEventAt: null };

    this.stats.set(name, fresh);

    return fresh;
  }

  private recordEvent(name: string): void {
    const stats = this.ensureStats(name);

    stats.events += 1;
    stats.lastEventAt = new Date(this.now()).toISOString();
  }

  private recordError(name: string): void {
    this.ensureStats(name).errors += 1;
  }

  async stop(name: string): Promise<{ ok: boolean; reason?: string }> {
    const entry = this.running.get(name);

    if (!entry) {
      return { ok: true, reason: "not running" };
    }

    try {
      await entry.listener.stop();
      this.running.delete(name);
      this.failureCounts.delete(name);
      this.logger.info(`${entry.config.type} listener stopped`, { connector: name });

      return { ok: true };
    } catch (error) {
      this.logger.error(`${entry.config.type} listener failed to stop`, {
        connector: name,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async restart(name: string): Promise<{ ok: boolean; reason?: string }> {
    const stopped = await this.stop(name);

    if (!stopped.ok) return stopped;

    return await this.start(name);
  }

  async startAll(): Promise<void> {
    const all = this.connectors.list();

    for (const config of all) {
      await this.start(config.name);
    }

    this.startHealthCheck();
  }

  async stopAll(): Promise<void> {
    this.stopHealthCheck();

    const names = [...this.running.keys()];

    for (const name of names) {
      await this.stop(name);
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(() => {
      void this.runHealthCheck();
    }, this.healthCheckIntervalMs);

    this.healthCheckTimer.unref();
  }

  private stopHealthCheck(): void {
    if (!this.healthCheckTimer) return;

    clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = null;
  }

  private async runHealthCheck(): Promise<void> {
    if (this.healthCheckInFlight) return;

    this.healthCheckInFlight = true;

    try {
      for (const [name, entry] of [...this.running.entries()]) {
        if (entry.listener.isAlive()) {
          this.failureCounts.delete(name);
          continue;
        }

        await this.recoverDead(name, entry.config.type);
      }
    } finally {
      this.healthCheckInFlight = false;
    }
  }

  private async recoverDead(name: string, type: ConnectorConfig["type"]): Promise<void> {
    const failureCount = this.failureCounts.get(name) ?? 0;
    const backoffMs = Math.min(1000 * 2 ** failureCount, this.maxBackoffMs);

    this.logger.warn(`${type} listener unhealthy, restarting`, {
      connector: name,
      attempt: failureCount + 1,
      backoffMs,
    });

    await this.stop(name);
    await this.sleep(backoffMs);

    const result = await this.start(name);

    if (result.ok) {
      this.failureCounts.delete(name);
      this.logger.info(`${type} listener recovered`, { connector: name });
    } else {
      this.failureCounts.set(name, failureCount + 1);
    }
  }
}
