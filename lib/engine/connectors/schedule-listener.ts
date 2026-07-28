import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { matchCron } from "@/engine/connectors/match-cron"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { FunnelConnectorDiagnosticsRecorder } from "@/engine/connectors/connector-diagnostics-recorder"
import { FunnelLogger } from "@/engine/logger/logger"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type {
  CronScheduleEntry,
  ScheduleConnectorConfig,
  ScheduleEntry,
} from "@/engine/connectors/schedule-connector-schema"

export type ScheduleOnFired = (entry: ScheduleEntry, firedAt: Date) => void | Promise<void>

type Deps = {
  config: ScheduleConnectorConfig
  lastFiredStore: FunnelScheduleStateStore
  /** Funnel channel uuid this connector lives under; stamped onto diagnostic-log rows. */
  channelId?: string
  logger?: FunnelLogger
  /** Diagnostic log of fired entries and lifecycle. No-op when absent. */
  diagnosticLog?: ConnectorDiagnosticLog
  now?: () => Date
  /**
   * Invoked after a schedule entry fires successfully. Use to remove one-shot
   * entries from the connector config, or to log per-fire side effects.
   * Errors from this callback are caught and logged; they do not abort the tick.
   */
  onFired?: ScheduleOnFired
}

const MAX_CATCHUP_MINUTES = 60 * 24

export class FunnelScheduleListener extends FunnelConnectorListener {
  private readonly config: ScheduleConnectorConfig
  private readonly lastFiredStore: FunnelScheduleStateStore
  private readonly logger: FunnelLogger | undefined
  private readonly diagnostics: FunnelConnectorDiagnosticsRecorder
  private readonly now: () => Date
  private readonly onFired: ScheduleOnFired | null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private tickScheduled = false

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.lastFiredStore = deps.lastFiredStore
    this.logger = deps.logger
    this.diagnostics = new FunnelConnectorDiagnosticsRecorder({
      type: "schedule",
      connectorId: deps.config.id,
      channelId: deps.channelId ?? null,
      log: deps.diagnosticLog,
    })
    this.now = deps.now ?? (() => new Date())
    this.onFired = deps.onFired ?? null
  }

  async start(notify: NotifyFn): Promise<void> {
    this.stopped = false
    this.tickScheduled = true

    this.diagnostics.recordConnection("started", "")

    const scheduleNext = () => {
      if (this.stopped) return

      const date = this.now()
      const msUntilNextMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
      this.timer = setTimeout(async () => {
        if (this.stopped) return

        try {
          await this.tick(notify)
        } catch (error) {
          this.recordTickError(error)
        }

        scheduleNext()
      }, msUntilNextMinute)

      this.timer.unref()
      this.tickScheduled = true
    }

    try {
      await this.tick(notify)
    } catch (error) {
      this.recordTickError(error)
    }

    // Connection lifecycle parity with the flume-backed listeners: the timer
    // is armed, so the connector is "connected" for diagnostic purposes.
    this.diagnostics.recordConnection("connected", "")

    scheduleNext()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.tickScheduled = false

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.diagnostics.recordConnection("disconnected", "")
    this.diagnostics.recordConnection("stopped", "")
  }

  private recordTickError(error: unknown): void {
    const message = errorMessageOf(error)
    this.diagnostics.recordConnection("error", `tick: ${message}`)
    this.logger?.error("schedule tick failed", {
      connector: this.config.name,
      error: message,
    })
  }

  override isAlive(): boolean {
    return !this.stopped && this.tickScheduled
  }

  async tick(notify: NotifyFn): Promise<void> {
    const now = this.truncateToMinute(this.now())
    const state = this.lastFiredStore.load()
    const changes = [this.pruneRemovedEntries(state)]

    for (const entry of this.config.entries) {
      if (!entry.enabled) continue

      const fired = await this.fireEntry(entry, now, state, notify)

      changes.push(fired)
    }

    if (changes.includes(true)) this.lastFiredStore.save(state)
  }

  private async fireEntry(
    entry: ScheduleEntry,
    now: Date,
    state: Map<string, Date>,
    notify: NotifyFn,
  ): Promise<boolean> {
    if (entry.kind === "once") {
      return this.fireOnceEntry(entry, now, state, notify)
    }

    return this.fireCronEntry(entry, now, state, notify)
  }

  private async fireOnceEntry(
    entry: Extract<ScheduleEntry, { kind: "once" }>,
    now: Date,
    state: Map<string, Date>,
    notify: NotifyFn,
  ): Promise<boolean> {
    if (state.has(entry.id)) return false

    const runAt = new Date(entry.runAt)
    if (now.getTime() < runAt.getTime()) return false

    const lateness = now.getTime() - runAt.getTime()

    if (entry.catchupPolicy === "skip" && lateness >= 60_000) {
      state.set(entry.id, runAt)
      return true
    }

    await this.notifyOne(entry, runAt, notify, lateness > 0)
    state.set(entry.id, runAt)
    return true
  }

  private async fireCronEntry(
    entry: CronScheduleEntry,
    now: Date,
    state: Map<string, Date>,
    notify: NotifyFn,
  ): Promise<boolean> {
    const lastFired = state.get(entry.id)
    const createdAt = entry.createdAt ? this.truncateToMinute(new Date(entry.createdAt)) : now
    const searchFrom = lastFired ? new Date(lastFired.getTime() + 60_000) : createdAt

    if (searchFrom.getTime() > now.getTime()) return false

    if (entry.catchupPolicy === "skip") {
      try {
        if (!matchCron(entry.cron, now)) return false
      } catch (error) {
        this.logInvalidCron(entry, error)
        return false
      }

      await this.notifyOne(entry, now, notify, false)
      state.set(entry.id, now)
      return true
    }

    if (entry.catchupPolicy === "all") {
      const matches = this.findAllMatches(entry.cron, searchFrom, now, entry.id)

      if (matches.length === 0) return this.seedSearchWatermark(entry.id, lastFired, now, state)

      for (const match of matches) {
        await this.notifyOne(entry, match, notify, match.getTime() !== now.getTime())
      }

      state.set(entry.id, matches[matches.length - 1] ?? now)
      return true
    }

    const match = this.findMostRecentMatch(entry.cron, searchFrom, now, entry.id)

    if (!match) return this.seedSearchWatermark(entry.id, lastFired, now, state)

    await this.notifyOne(entry, match, notify, match.getTime() !== now.getTime())
    state.set(entry.id, match)
    return true
  }

  private seedSearchWatermark(
    entryId: string,
    lastFired: Date | undefined,
    now: Date,
    state: Map<string, Date>,
  ): boolean {
    if (lastFired !== undefined) return false

    state.set(entryId, now)
    return true
  }

  private async notifyOne(
    entry: ScheduleEntry,
    firedAt: Date,
    notify: NotifyFn,
    catchup: boolean,
  ): Promise<void> {
    const meta: Record<string, string> = {
      event_type: "schedule",
      schedule_id: entry.id,
      schedule_kind: entry.kind,
      fired_at: firedAt.toISOString(),
      catchup_policy: entry.catchupPolicy,
    }

    if (entry.kind === "cron") {
      meta.cron = entry.cron
    } else {
      meta.run_at = entry.runAt
    }

    if (catchup) meta.catchup = "true"

    // A fire is this connector's "inbound event". The id pairs the entry with
    // the exact firing time so catch-up fires of one entry stay distinct.
    const eventId = `${entry.id}@${firedAt.toISOString()}`

    this.diagnostics.recordRaw(
      eventId,
      JSON.stringify({
        schedule_id: entry.id,
        kind: entry.kind,
        ...(entry.kind === "cron" ? { cron: entry.cron } : { run_at: entry.runAt }),
        prompt: entry.prompt,
        fired_at: firedAt.toISOString(),
        catchup,
      }),
    )

    try {
      await notify(entry.prompt, meta)
    } catch (error) {
      this.diagnostics.recordProcessed(eventId, "emitted:delivery-failed", entry.prompt)
      throw error
    }

    this.diagnostics.recordProcessed(eventId, "emitted", entry.prompt)

    if (this.onFired) {
      try {
        await this.onFired(entry, firedAt)
      } catch (error) {
        this.logger?.error("schedule onFired callback failed", {
          connector: this.config.name,
          id: entry.id,
          error: errorMessageOf(error),
        })
      }
    }
  }

  private findMostRecentMatch(cron: string, from: Date, until: Date, entryId: string): Date | null {
    const maxIterations = Math.min(
      MAX_CATCHUP_MINUTES,
      Math.floor((until.getTime() - from.getTime()) / 60_000) + 1,
    )

    for (let i = 0; i < maxIterations; i++) {
      const candidate = new Date(until.getTime() - i * 60_000)

      try {
        if (matchCron(cron, candidate)) return candidate
      } catch (error) {
        this.logInvalidCron({ id: entryId, cron }, error)
        return null
      }
    }

    return null
  }

  private findAllMatches(cron: string, from: Date, until: Date, entryId: string): Date[] {
    const maxIterations = Math.min(
      MAX_CATCHUP_MINUTES,
      Math.floor((until.getTime() - from.getTime()) / 60_000) + 1,
    )
    const matches: Date[] = []

    for (let i = 0; i < maxIterations; i++) {
      const candidate = new Date(from.getTime() + i * 60_000)

      if (candidate.getTime() > until.getTime()) break

      try {
        if (matchCron(cron, candidate)) matches.push(candidate)
      } catch (error) {
        this.logInvalidCron({ id: entryId, cron }, error)
        return []
      }
    }

    return matches
  }

  private logInvalidCron(entry: { id: string; cron: string }, error: unknown): void {
    const message = errorMessageOf(error)

    this.diagnostics.recordConnection(
      "error",
      `invalid cron "${entry.cron}" (entry ${entry.id}): ${message}`,
    )
    this.logger?.error("invalid cron expression in schedule", {
      connector: this.config.name,
      id: entry.id,
      cron: entry.cron,
      error: message,
    })
  }

  private truncateToMinute(date: Date): Date {
    const copy = new Date(date.getTime())
    copy.setSeconds(0, 0)
    return copy
  }

  private pruneRemovedEntries(state: Map<string, Date>): boolean {
    const configuredIds = new Set(this.config.entries.map((entry) => entry.id))
    const removedIds: string[] = []

    for (const id of state.keys()) {
      if (configuredIds.has(id)) continue

      state.delete(id)
      removedIds.push(id)
    }

    return removedIds.length > 0
  }
}
