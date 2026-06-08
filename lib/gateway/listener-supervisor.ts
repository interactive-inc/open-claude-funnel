import type { ConnectorConfig } from "@/engine/connectors/connector-config-schema"
import type { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ChannelConnectorView } from "@/engine/channels/channels"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { FunnelLogger } from "@/engine/logger/logger"

type ConnectorRegistry = {
  listAllConnectors(): ChannelConnectorView[]
  createListener(
    channelName: string,
    connectorName: string,
  ): { config: ConnectorConfig; channelId: string; listener: FunnelConnectorListener } | null
}

type SupervisorNotify = (
  channelName: string,
  connectorName: string,
  content: string,
  meta?: Record<string, string>,
) => Promise<void>

type RunningEntry = {
  config: ConnectorConfig
  channelName: string
  channelId: string
  listener: FunnelConnectorListener
}

type ListenerStats = {
  events: number
  errors: number
  failureCount: number
  lastEventAt: string | null
}

type Deps = {
  channels: ConnectorRegistry
  notify: SupervisorNotify
  logger?: FunnelLogger
  /** Host hook for surfacing listener lifecycle exceptions. Defaults to no-op. */
  onError?: OnFunnelError
  healthCheckIntervalMs?: number
  maxBackoffMs?: number
  /** Per-listener timeout for `start()`. A listener that hangs beyond this is
   *  treated as a startup failure — it won't block other listeners or the
   *  health-check loop. Defaults to 30 seconds. */
  startTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultOnError: OnFunnelError = () => {}
const DEFAULT_HEALTH_INTERVAL_MS = 30_000
const DEFAULT_MAX_BACKOFF_MS = 60_000
const DEFAULT_START_TIMEOUT_MS = 30_000

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms)
  })

type ListenerEntryStatus = {
  channelName: string
  channelId: string
  name: string
  type: ConnectorConfig["type"]
  alive: boolean
  events: number
  errors: number
  failureCount: number
  lastEventAt: string | null
}

/**
 * Owns the running listener instances and their lifecycle.
 *
 * Lives in the gateway process and is the only place that calls
 * `listener.start()` / `listener.stop()`. Each entry is keyed by
 * `${channelName}/${connectorName}` so the same connector name can exist in
 * multiple channels without colliding.
 *
 * Periodically polls each running listener's `isAlive()` and auto-restarts
 * dead listeners with exponential backoff (1s, 2s, 4s, ... capped). Resets
 * the backoff counter on successful restart.
 */
export class FunnelListenerSupervisor {
  private readonly channels: ConnectorRegistry
  private readonly notify: SupervisorNotify
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError
  private readonly running = new Map<string, RunningEntry>()
  private readonly failureCounts = new Map<string, number>()
  private readonly stats = new Map<string, ListenerStats>()
  private readonly healthCheckIntervalMs: number
  private readonly maxBackoffMs: number
  private readonly startTimeoutMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private healthCheckInFlight = false
  /** Connectors that failed initial start — retried by the health check. */
  private readonly pendingRetry = new Map<string, { channelName: string; connectorName: string }>()

  constructor(deps: Deps) {
    this.channels = deps.channels
    this.notify = deps.notify
    this.logger = deps.logger
    this.onError = deps.onError ?? defaultOnError
    this.healthCheckIntervalMs = deps.healthCheckIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS
    this.maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.startTimeoutMs = deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
    this.sleep = deps.sleep ?? defaultSleep
    this.now = deps.now ?? (() => Date.now())
  }

  static keyOf(channelName: string, connectorName: string): string {
    return `${channelName}/${connectorName}`
  }

  isRunning(channelName: string, connectorName: string): boolean {
    return this.running.has(FunnelListenerSupervisor.keyOf(channelName, connectorName))
  }

  list(): ListenerEntryStatus[] {
    return [...this.running.entries()].map(([key, entry]) => {
      const stats = this.stats.get(key)

      return {
        channelName: entry.channelName,
        channelId: entry.channelId,
        name: entry.config.name,
        type: entry.config.type,
        alive: entry.listener.isAlive(),
        events: stats?.events ?? 0,
        errors: stats?.errors ?? 0,
        failureCount: this.failureCounts.get(key) ?? 0,
        lastEventAt: stats?.lastEventAt ?? null,
      }
    })
  }

  async start(
    channelName: string,
    connectorName: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const key = FunnelListenerSupervisor.keyOf(channelName, connectorName)

    if (this.running.has(key)) {
      return { ok: true, reason: "already running" }
    }

    const created = this.channels.createListener(channelName, connectorName)

    if (!created) {
      return {
        ok: false,
        reason: `connector "${connectorName}" not found in channel "${channelName}"`,
      }
    }

    const bind = async (content: string, meta?: Record<string, string>) => {
      try {
        await this.notify(channelName, connectorName, content, meta)
        this.recordEvent(key)
      } catch (error) {
        this.recordError(key)
        throw error
      }
    }

    try {
      await Promise.race([
        created.listener.start(bind),
        this.sleep(this.startTimeoutMs).then(() => {
          throw new Error(`listener start timed out after ${this.startTimeoutMs}ms`)
        }),
      ])
      this.running.set(key, {
        config: created.config,
        channelName,
        channelId: created.channelId,
        listener: created.listener,
      })
      this.pendingRetry.delete(key)
      this.ensureStats(key)
      this.logger?.info(`${created.config.type} listener started`, {
        channel: channelName,
        connector: connectorName,
      })

      return { ok: true }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      this.logger?.error(`${created.config.type} listener failed to start`, {
        channel: channelName,
        connector: connectorName,
        error: err.message,
      })
      this.onError(err, {
        component: "listener-supervisor.start",
        channel: channelName,
        connector: connectorName,
        type: created.config.type,
      })

      return { ok: false, reason: err.message }
    }
  }

  async stop(
    channelName: string,
    connectorName: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const key = FunnelListenerSupervisor.keyOf(channelName, connectorName)
    const entry = this.running.get(key)

    if (!entry) return { ok: true, reason: "not running" }

    try {
      await entry.listener.stop()
      this.running.delete(key)
      this.failureCounts.delete(key)
      this.logger?.info(`${entry.config.type} listener stopped`, {
        channel: channelName,
        connector: connectorName,
      })

      return { ok: true }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      this.logger?.error(`${entry.config.type} listener failed to stop`, {
        channel: channelName,
        connector: connectorName,
        error: err.message,
      })
      this.onError(err, {
        component: "listener-supervisor.stop",
        channel: channelName,
        connector: connectorName,
        type: entry.config.type,
      })

      return { ok: false, reason: err.message }
    }
  }

  async restart(
    channelName: string,
    connectorName: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const stopped = await this.stop(channelName, connectorName)

    if (!stopped.ok) return stopped

    return await this.start(channelName, connectorName)
  }

  async startAll(): Promise<void> {
    const all = this.channels.listAllConnectors()

    const results = await Promise.allSettled(
      all.map((view) => this.start(view.channelName, view.name)),
    )

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const view = all[i]!

      if (result.status === "rejected" || (result.status === "fulfilled" && !result.value.ok)) {
        const key = FunnelListenerSupervisor.keyOf(view.channelName, view.name)
        this.pendingRetry.set(key, { channelName: view.channelName, connectorName: view.name })
      }
    }

    this.startHealthCheck()
  }

  async stopAll(): Promise<void> {
    this.stopHealthCheck()
    this.pendingRetry.clear()

    for (const [, entry] of [...this.running.entries()]) {
      await this.stop(entry.channelName, entry.config.name)
    }
  }

  private ensureStats(key: string): ListenerStats {
    const existing = this.stats.get(key)

    if (existing) return existing

    const fresh: ListenerStats = { events: 0, errors: 0, failureCount: 0, lastEventAt: null }

    this.stats.set(key, fresh)

    return fresh
  }

  private recordEvent(key: string): void {
    const stats = this.ensureStats(key)

    stats.events += 1
    stats.lastEventAt = new Date(this.now()).toISOString()
  }

  private recordError(key: string): void {
    this.ensureStats(key).errors += 1
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) return

    this.healthCheckTimer = setInterval(() => {
      void this.runHealthCheck()
    }, this.healthCheckIntervalMs)

    this.healthCheckTimer.unref()
  }

  private stopHealthCheck(): void {
    if (!this.healthCheckTimer) return

    clearInterval(this.healthCheckTimer)
    this.healthCheckTimer = null
  }

  private async runHealthCheck(): Promise<void> {
    if (this.healthCheckInFlight) return

    this.healthCheckInFlight = true

    try {
      for (const [key, entry] of [...this.running.entries()]) {
        if (entry.listener.isAlive()) {
          this.failureCounts.delete(key)
          continue
        }

        await this.recoverDead(entry.channelName, entry.config.name, entry.config.type)
      }

      for (const [key, pending] of [...this.pendingRetry.entries()]) {
        if (this.running.has(key)) {
          this.pendingRetry.delete(key)
          continue
        }

        this.logger?.info("retrying failed listener", {
          channel: pending.channelName,
          connector: pending.connectorName,
        })

        const failureCount = this.failureCounts.get(key) ?? 0
        const backoffMs = Math.min(1000 * 2 ** failureCount, this.maxBackoffMs)

        await this.sleep(backoffMs)

        const result = await this.start(pending.channelName, pending.connectorName)

        if (result.ok) {
          this.pendingRetry.delete(key)
          this.failureCounts.delete(key)
        } else {
          this.failureCounts.set(key, failureCount + 1)
        }
      }
    } finally {
      this.healthCheckInFlight = false
    }
  }

  private async recoverDead(
    channelName: string,
    connectorName: string,
    type: ConnectorConfig["type"],
  ): Promise<void> {
    const key = FunnelListenerSupervisor.keyOf(channelName, connectorName)
    const failureCount = this.failureCounts.get(key) ?? 0
    const backoffMs = Math.min(1000 * 2 ** failureCount, this.maxBackoffMs)

    this.logger?.warn(`${type} listener unhealthy, restarting`, {
      channel: channelName,
      connector: connectorName,
      attempt: failureCount + 1,
      backoffMs,
    })

    await this.stop(channelName, connectorName)
    await this.sleep(backoffMs)

    const result = await this.start(channelName, connectorName)

    if (result.ok) {
      this.failureCounts.delete(key)
      this.logger?.info(`${type} listener recovered`, {
        channel: channelName,
        connector: connectorName,
      })
    } else {
      this.failureCounts.set(key, failureCount + 1)
    }
  }
}
