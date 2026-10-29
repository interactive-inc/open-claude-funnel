import type { BaseConnectorConfig } from "@/engine/connectors/base-connector-config"
import type { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ChannelConnectorView } from "@/engine/channels/channels"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { FunnelAuthFailedError } from "@/engine/error/funnel-error"
import { FunnelLogger } from "@/engine/logger/logger"

type ConnectorRegistry = {
  listAllConnectors(): ChannelConnectorView[]
  createListener(
    channelName: string,
    connectorName: string,
  ): { config: BaseConnectorConfig; channelId: string; listener: FunnelConnectorListener } | null
}

type ListenerRegistryNotify = (
  channelName: string,
  connectorName: string,
  content: string,
  meta?: Record<string, string>,
) => Promise<void>

type RunningEntry = {
  config: BaseConnectorConfig
  channelName: string
  channelId: string
  listener: FunnelConnectorListener
  controller: AbortController
}

type StartResult = { ok: boolean; reason?: string; retriable?: boolean }
type StartingEntry = { controller: AbortController; completion: Promise<StartResult> }

type ListenerStats = {
  events: number
  errors: number
  failureCount: number
  lastEventAt: string | null
}

type Deps = {
  channels: ConnectorRegistry
  notify: ListenerRegistryNotify
  logger?: FunnelLogger
  /** Host hook for surfacing listener lifecycle exceptions. Defaults to no-op. */
  onError?: OnFunnelError
  healthCheckIntervalMs?: number
  maxBackoffMs?: number
  /** Per-listener timeout for `start()`. A listener that hangs beyond this is
   *  treated as a startup failure — it won't block other listeners or the
   *  health-check loop. Defaults to 30 seconds. */
  startTimeoutMs?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}

const defaultOnError: OnFunnelError = () => {}
const DEFAULT_HEALTH_INTERVAL_MS = 30_000
const DEFAULT_MAX_BACKOFF_MS = 60_000
const DEFAULT_START_TIMEOUT_MS = 30_000

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener("abort", finish, { once: true })
  })
}

type ListenerEntryStatus = {
  channelName: string
  channelId: string
  name: string
  type: string
  alive: boolean
  connected: boolean
  events: number
  errors: number
  failureCount: number
  lastEventAt: string | null
}

/**
 * Owns the running listener instances and their lifecycle.
 *
 * Lives in the gateway process and is the only place that calls
 * `listener.start()` / `listener.stop()`. Each entry is keyed by stable
 * channel and connector IDs. Labels can change without changing ownership,
 * a pending start lock, or an operator's stop intent.
 *
 * Periodically polls each running listener's `isAlive()` and auto-restarts
 * dead listeners with exponential backoff (1s, 2s, 4s, ... capped). Resets
 * the backoff counter on successful restart.
 */
export class FunnelListenerRegistry {
  private readonly channels: ConnectorRegistry
  private readonly notify: ListenerRegistryNotify
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError
  private readonly running = new Map<string, RunningEntry>()
  private readonly failureCounts = new Map<string, number>()
  private readonly starting = new Map<string, StartingEntry>()
  private readonly stopping = new Map<string, Promise<StartResult>>()
  private readonly stopped = new Set<string>()
  private readonly revisions = new Map<string, number>()
  private readonly recoveryWaits = new Map<string, AbortController>()
  private lifecycle = 0
  private isStopped = false
  private stoppingAll: Promise<void> | null = null
  private readonly nonRetriable = new Set<string>()
  private readonly stats = new Map<string, ListenerStats>()
  private readonly healthCheckIntervalMs: number
  private readonly maxBackoffMs: number
  private readonly startTimeoutMs: number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
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

  static keyOf(channelId: string, connectorId: string): string {
    return JSON.stringify([channelId, connectorId])
  }

  private configured(key: string): ChannelConnectorView | undefined {
    return this.channels
      .listAllConnectors()
      .find((view) => FunnelListenerRegistry.keyOf(view.channelId, view.id) === key)
  }

  private resolveKey(channelName: string, connectorName: string): string {
    const configured = this.channels
      .listAllConnectors()
      .find((view) => view.channelName === channelName && view.name === connectorName)
    if (configured) return FunnelListenerRegistry.keyOf(configured.channelId, configured.id)
    // An orphaned source can still be stopped before the next health pass.
    const detached = [...this.running].find(
      ([, entry]) => entry.channelName === channelName && entry.config.name === connectorName,
    )
    return detached?.[0] ?? JSON.stringify(["missing", channelName, connectorName])
  }

  isRunning(channelName: string, connectorName: string): boolean {
    return this.running.has(this.resolveKey(channelName, connectorName))
  }

  list(): ListenerEntryStatus[] {
    return [...this.running.entries()].map(([key, entry]) => {
      const stats = this.stats.get(key)
      const current = this.configured(key)

      return {
        channelName: current?.channelName ?? entry.channelName,
        channelId: entry.channelId,
        name: current?.name ?? entry.config.name,
        type: entry.config.type,
        alive: entry.listener.isAlive(),
        connected: entry.listener.isConnected(),
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
  ): Promise<{ ok: boolean; reason?: string; retriable?: boolean }> {
    const key = this.resolveKey(channelName, connectorName)

    if (!this.configured(key))
      return {
        ok: false,
        reason: `connector "${connectorName}" not found in channel "${channelName}"`,
      }

    if (this.stoppingAll) return { ok: false, reason: "registry is stopping" }
    if (this.stopping.has(key))
      return { ok: false, reason: "listener is stopping", retriable: true }

    // A direct start is an operator/configuration-driven retry. Clear a prior
    // permanent-failure latch so corrected credentials can be tried again.
    this.nonRetriable.delete(key)

    if (this.running.has(key)) {
      return { ok: true, reason: "already running" }
    }

    // Per-key start guard: without this, a concurrent pendingRetry +
    // operator-driven restart could both pass the `running.has(key)` check,
    // both spawn a listener (each opening a Slack socket on the same token),
    // and only register one — the loser would leak a second Socket Mode
    // connection that Slack splits inbound events across.
    if (this.starting.has(key)) {
      return { ok: false, reason: "already starting", retriable: true }
    }

    this.isStopped = false
    this.stopped.delete(key)
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1)
    this.recoveryWaits.get(key)?.abort()
    const controller = new AbortController()
    const completion = Promise.resolve().then(() =>
      this.startLocked({ channelName, connectorName, key, controller }),
    )
    this.starting.set(key, { controller, completion })

    try {
      const result = await completion

      if (!this.isStopped && !this.stopped.has(key) && this.configured(key)) {
        this.trackStartResult(key, channelName, connectorName, result)
      }

      return result
    } finally {
      this.starting.delete(key)
    }
  }

  private trackStartResult(
    key: string,
    channelName: string,
    connectorName: string,
    result: { ok: boolean; retriable?: boolean },
  ): void {
    if (result.ok) {
      this.pendingRetry.delete(key)
      this.nonRetriable.delete(key)
      return
    }

    if (result.retriable === false) {
      this.pendingRetry.delete(key)
      this.nonRetriable.add(key)
      return
    }

    if (result.retriable !== true) return

    this.pendingRetry.set(key, { channelName, connectorName })
  }

  private async startLocked(input: {
    channelName: string
    connectorName: string
    key: string
    controller: AbortController
  }): Promise<StartResult> {
    const key = input.key
    const signal = input.controller.signal

    if (signal.aborted) return { ok: false, reason: "start cancelled" }

    const current = this.configured(key)
    const channelName = current?.channelName ?? input.channelName
    const connectorName = current?.name ?? input.connectorName

    let created: ReturnType<ConnectorRegistry["createListener"]> = null
    const startup = { needsLateCleanup: false }
    const deadline = new AbortController()

    try {
      created = current ? this.channels.createListener(channelName, connectorName) : null
      if (!created) {
        return {
          ok: false,
          reason: `connector "${connectorName}" not found in channel "${channelName}"`,
        }
      }

      const bind = async (content: string, meta?: Record<string, string>) => {
        if (signal.aborted || this.isStopped || this.stopped.has(key))
          throw new Error("listener stopped before delivery")

        try {
          const current = this.configured(key)
          if (!current) throw new Error("listener configuration no longer exists")
          await this.notify(current.channelName, current.name, content, meta)
          this.recordEvent(key)
        } catch (error) {
          this.recordError(key)
          throw error
        }
      }

      const listener = created.listener
      const opened = listener.start(bind, signal)
      void opened
        .then(
          async () => {
            // A timed-out start may still finish opening its transport later.
            if (startup.needsLateCleanup) await listener.stop()
          },
          () => {},
        )
        .catch((error: unknown) => {
          const err = error instanceof Error ? error : new Error(String(error))
          this.onError(err, {
            component: "listener-registry.late-stop",
            channel: channelName,
            connector: connectorName,
          })
        })
      await Promise.race([
        opened,
        this.sleep(this.startTimeoutMs, AbortSignal.any([signal, deadline.signal])).then(() => {
          throw new Error(`listener start timed out after ${this.startTimeoutMs}ms`)
        }),
      ])
      if (signal.aborted || !this.configured(key)) {
        await listener.stop()
        return { ok: false, reason: "start cancelled" }
      }

      this.running.set(key, {
        config: { ...created.config },
        channelName,
        channelId: created.channelId,
        listener: created.listener,
        controller: input.controller,
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
      const wasCancelled = signal.aborted
      startup.needsLateCleanup = true
      input.controller.abort()

      try {
        await created?.listener.stop()
      } catch {
        // best-effort cleanup; the listener may be partially initialized
      }

      if (wasCancelled) return { ok: false, reason: "start cancelled" }

      const type = created?.config.type ?? current?.type ?? "unknown"
      this.logger?.error(`${type} listener failed to start`, {
        channel: channelName,
        connector: connectorName,
        error: err.message,
      })
      this.onError(err, {
        component: "listener-registry.start",
        channel: channelName,
        connector: connectorName,
        type,
      })

      // Auth failures need host action (token rotation) and will keep
      // returning the same error on every retry, so surface them as
      // non-retriable. Callers (startAll / recoverDead / health check)
      // skip pendingRetry / restart for these.
      const retriable = !(err instanceof FunnelAuthFailedError)

      return { ok: false, reason: err.message, retriable }
    } finally {
      deadline.abort()
    }
  }

  async stop(
    channelName: string,
    connectorName: string,
  ): Promise<{ ok: boolean; reason?: string; retriable?: boolean }> {
    return this.stopKey(this.resolveKey(channelName, connectorName))
  }

  private async stopKey(key: string): Promise<StartResult> {
    this.stopped.add(key)
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1)
    this.recoveryWaits.get(key)?.abort()

    return this.stopEntry(key)
  }

  private async stopEntry(key: string): Promise<StartResult> {
    const existing = this.stopping.get(key)

    if (existing) return existing

    const completion = Promise.resolve().then(() => this.stopLocked(key))
    this.stopping.set(key, completion)

    try {
      return await completion
    } finally {
      this.stopping.delete(key)
    }
  }

  private async stopLocked(key: string): Promise<StartResult> {
    const starting = this.starting.get(key)
    starting?.controller.abort()
    this.running.get(key)?.controller.abort()

    if (starting) await starting.completion.catch(() => {})

    const entry = this.running.get(key)

    this.pendingRetry.delete(key)
    this.nonRetriable.delete(key)
    this.failureCounts.delete(key)

    if (!entry) return { ok: true, reason: "not running" }
    const current = this.configured(key)
    const channelName = current?.channelName ?? entry.channelName
    const connectorName = current?.name ?? entry.config.name

    try {
      await entry.listener.stop()
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
        component: "listener-registry.stop",
        channel: channelName,
        connector: connectorName,
        type: entry.config.type,
      })

      return { ok: false, reason: err.message }
    } finally {
      // Drop the entry from the registry whether or not listener.stop() threw.
      // A throwing stop used to leave the entry behind, so the next start() saw
      // `running.has(key) === true` and returned "already running" without
      // reconstructing the listener — a dead listener got stuck in the registry
      // and the registry's recoverDead loop spun forever without restarting.
      this.running.delete(key)
    }
  }

  async restart(
    channelName: string,
    connectorName: string,
  ): Promise<{ ok: boolean; reason?: string; retriable?: boolean }> {
    if (this.stoppingAll) return { ok: false, reason: "registry is stopping" }
    const key = this.resolveKey(channelName, connectorName)
    const lifecycle = this.lifecycle
    const stopping = this.stopKey(key)
    const revision = this.revisions.get(key)
    const stopped = await stopping

    if (!stopped.ok) return stopped
    if (this.stoppingAll || lifecycle !== this.lifecycle || revision !== this.revisions.get(key))
      return { ok: false, reason: "restart cancelled by a newer lifecycle request" }

    const current = this.configured(key)
    if (!current)
      return {
        ok: false,
        reason: `connector "${connectorName}" no longer configured in channel "${channelName}"`,
      }
    return await this.start(current.channelName, current.name)
  }

  async startAll(): Promise<void> {
    if (this.stoppingAll) await this.stoppingAll

    this.isStopped = false
    const lifecycle = this.lifecycle
    await this.reconcileConfiguredListeners()
    if (this.isStopped || lifecycle !== this.lifecycle) return
    const all = this.channels.listAllConnectors()

    const results = await Promise.allSettled(
      all.map((view) => this.start(view.channelName, view.name)),
    )

    if (this.isStopped || lifecycle !== this.lifecycle) return

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const view = all[i]!
      const key = FunnelListenerRegistry.keyOf(view.channelId, view.id)

      if (this.stopped.has(key) || !this.configured(key)) continue

      if (result.status === "rejected") {
        // throw paths are always retriable — only the structured
        // `{ ok: false, retriable: false }` return marks a permanent failure.
        this.pendingRetry.set(key, { channelName: view.channelName, connectorName: view.name })
        continue
      }

      if (result.status === "fulfilled" && !result.value.ok) {
        // Skip pendingRetry for non-retriable failures (e.g. auth-failed).
        // The operator has to rotate the token / fix config before any
        // retry can succeed; spinning on a 401 / invalid_auth wastes CPU
        // and logs nothing new every backoff interval.
        if (result.value.retriable === false) continue

        this.pendingRetry.set(key, { channelName: view.channelName, connectorName: view.name })
      }
    }

    this.startHealthCheck()
  }

  async stopAll(): Promise<void> {
    if (this.stoppingAll) return this.stoppingAll

    this.isStopped = true
    this.lifecycle += 1
    this.stopHealthCheck()
    this.pendingRetry.clear()
    this.nonRetriable.clear()

    const completion = Promise.resolve().then(() => this.finishStopAll())
    this.stoppingAll = completion

    for (const entry of this.starting.values()) entry.controller.abort()
    for (const entry of this.running.values()) entry.controller.abort()
    for (const controller of this.recoveryWaits.values()) controller.abort()

    try {
      await completion
    } finally {
      if (this.stoppingAll === completion) this.stoppingAll = null
    }
  }

  private async finishStopAll(): Promise<void> {
    await Promise.allSettled([...this.starting.values()].map((entry) => entry.completion))
    await Promise.all([...this.running.keys()].map((key) => this.stopKey(key)))
    this.pendingRetry.clear()
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
      // Catch any rejection so a single health-check failure cannot crash
      // the gateway daemon. `runHealthCheck` already wraps each per-listener
      // recover/retry in try/catch, but `Promise.all` rejection could still
      // surface here. Route to onError so host observability sees it.
      this.runHealthCheck().catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        this.logger?.error("health check pass failed", { error: err.message })
        this.onError(err, { component: "listener-registry.health-check" })
      })
    }, this.healthCheckIntervalMs)

    this.healthCheckTimer.unref()
  }

  private stopHealthCheck(): void {
    if (!this.healthCheckTimer) return

    clearInterval(this.healthCheckTimer)
    this.healthCheckTimer = null
  }

  /** Run one health-check pass synchronously. Test-only seam. */
  async runHealthCheckForTest(): Promise<void> {
    await this.runHealthCheck()
  }

  private async runHealthCheck(): Promise<void> {
    if (this.healthCheckInFlight || this.isStopped) return

    this.healthCheckInFlight = true
    const lifecycle = this.lifecycle

    try {
      await this.reconcileConfiguredListeners()
      if (this.isStopped || lifecycle !== this.lifecycle) return

      // Recover dead listeners in parallel — each recoverDead awaits its own
      // backoff sleep, and a sequential `for await` would serialise the
      // sleeps so a 10-connector mass-disconnect would take 10 × backoffMs
      // before the last one even started restarting. Mass disconnects
      // happen on host hibernate-resume and OS-level network changes; the
      // parallel form keeps the worst-case restart time at one backoff.
      const dead: Array<{ key: string; type: string }> = []

      for (const [key, entry] of this.running.entries()) {
        if (entry.listener.isAlive()) {
          this.failureCounts.delete(key)
          continue
        }

        dead.push({
          key,
          type: entry.config.type,
        })
      }

      await Promise.all(dead.map((target) => this.recoverDead(target.key, target.type)))

      // pendingRetry runs in parallel for the same reason: each entry
      // sleeps its own backoff before re-attempting start.
      const retries: Array<{
        key: string
        channelName: string
        connectorName: string
      }> = []

      for (const [key, pending] of this.pendingRetry.entries()) {
        if (this.running.has(key)) {
          this.pendingRetry.delete(key)
          continue
        }

        retries.push({
          key,
          channelName: pending.channelName,
          connectorName: pending.connectorName,
        })
      }

      await Promise.all(retries.map((retry) => this.attemptRetry(retry)))
    } finally {
      this.healthCheckInFlight = false
    }
  }

  private async reconcileConfiguredListeners(): Promise<void> {
    const lifecycle = this.lifecycle
    const configured = new Map(
      this.channels
        .listAllConnectors()
        .map((view) => [FunnelListenerRegistry.keyOf(view.channelId, view.id), view]),
    )
    for (const [key, entry] of this.starting) {
      if (!configured.has(key)) entry.controller.abort()
    }
    for (const [key, controller] of this.recoveryWaits) {
      if (!configured.has(key)) controller.abort()
    }
    await Promise.all(
      [...this.running.keys()]
        .filter((key) => !configured.has(key))
        .map((key) => this.stopKey(key)),
    )
    if (this.isStopped || lifecycle !== this.lifecycle) return
    for (const state of [
      this.pendingRetry,
      this.nonRetriable,
      this.stopped,
      this.failureCounts,
      this.stats,
      this.revisions,
    ]) {
      for (const key of state.keys()) {
        if (
          !configured.has(key) &&
          !this.starting.has(key) &&
          !this.running.has(key) &&
          !this.stopping.has(key)
        )
          state.delete(key)
      }
    }
    for (const [key, view] of configured) {
      if (this.pendingRetry.has(key))
        this.pendingRetry.set(key, { channelName: view.channelName, connectorName: view.name })

      if (this.running.has(key)) continue
      if (this.starting.has(key)) continue
      if (this.stopping.has(key)) continue
      if (this.pendingRetry.has(key)) continue
      if (this.nonRetriable.has(key)) continue
      if (this.stopped.has(key)) continue

      this.pendingRetry.set(key, { channelName: view.channelName, connectorName: view.name })
    }
  }

  private async attemptRetry(retry: {
    key: string
    channelName: string
    connectorName: string
  }): Promise<void> {
    const lifecycle = this.lifecycle
    const revision = this.revisions.get(retry.key)
    this.logger?.info("retrying failed listener", {
      channel: retry.channelName,
      connector: retry.connectorName,
    })

    const failureCount = this.failureCounts.get(retry.key) ?? 0
    const backoffMs = Math.min(1000 * 2 ** failureCount, this.maxBackoffMs)

    if (!this.canRecover(retry.key, lifecycle, revision)) return
    await this.waitBackoff(retry.key, backoffMs)

    if (!this.canRecover(retry.key, lifecycle, revision)) return

    const current = this.configured(retry.key)
    if (!current) return
    const result = await this.start(current.channelName, current.name)

    if (result.ok) {
      this.pendingRetry.delete(retry.key)
      this.failureCounts.delete(retry.key)
      return
    }

    if (result.retriable === false) {
      // Drop a non-retriable failure from the queue. The registry will
      // not poke it again until the operator calls restart() explicitly
      // (after rotating the token / fixing config).
      this.pendingRetry.delete(retry.key)
      this.failureCounts.delete(retry.key)
      this.logger?.warn("dropping listener from retry queue (non-retriable)", {
        channel: retry.channelName,
        connector: retry.connectorName,
        reason: result.reason,
      })
      return
    }

    this.failureCounts.set(retry.key, failureCount + 1)
  }

  private async recoverDead(key: string, type: string): Promise<void> {
    const initial = this.configured(key)
    if (!initial) return
    const channelName = initial.channelName
    const connectorName = initial.name
    const lifecycle = this.lifecycle
    const revision = this.revisions.get(key)
    const failureCount = this.failureCounts.get(key) ?? 0
    const backoffMs = Math.min(1000 * 2 ** failureCount, this.maxBackoffMs)

    this.logger?.warn(`${type} listener unhealthy, restarting`, {
      channel: channelName,
      connector: connectorName,
      attempt: failureCount + 1,
      backoffMs,
    })

    await this.stopEntry(key)
    if (!this.canRecover(key, lifecycle, revision)) return
    await this.waitBackoff(key, backoffMs)

    if (!this.canRecover(key, lifecycle, revision)) return

    const current = this.configured(key)
    if (!current) return
    const result = await this.start(current.channelName, current.name)

    if (result.ok) {
      this.failureCounts.delete(key)
      this.logger?.info(`${type} listener recovered`, {
        channel: channelName,
        connector: connectorName,
      })
    } else if (result.retriable === false) {
      // Non-retriable: stop bouncing on it. The diagnostic table will
      // still show auth-failed, and the host can restart the listener after rotating the credential.
      this.failureCounts.delete(key)
      this.logger?.warn(`${type} listener cannot recover (non-retriable)`, {
        channel: channelName,
        connector: connectorName,
        reason: result.reason,
      })
    } else {
      this.failureCounts.set(key, failureCount + 1)
    }
  }

  private async waitBackoff(key: string, ms: number): Promise<void> {
    const controller = new AbortController()
    this.recoveryWaits.set(key, controller)
    try {
      await this.sleep(ms, controller.signal)
    } finally {
      if (this.recoveryWaits.get(key) === controller) this.recoveryWaits.delete(key)
    }
  }

  private canRecover(key: string, lifecycle: number, revision: number | undefined): boolean {
    return (
      !this.isStopped &&
      !this.stopped.has(key) &&
      this.lifecycle === lifecycle &&
      this.revisions.get(key) === revision &&
      this.configured(key) !== undefined
    )
  }
}
