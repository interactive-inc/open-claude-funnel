import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { matchCron } from "@/engine/connectors/match-cron"
import { ScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { FunnelLogger } from "@/engine/logger/logger"
import type {
  ConnectorConnectionStatus,
  ConnectorDiagnosticLog,
} from "@/engine/diagnostic-log/diagnostic-log"
import type {
  ScheduleConnectorConfig,
  ScheduleEntry,
} from "@/engine/connectors/schedule-connector-schema"

export type ScheduleOnFired = (entry: ScheduleEntry, firedAt: Date) => void | Promise<void>

type Deps = {
  config: ScheduleConnectorConfig
  lastFiredStore: ScheduleStateStore
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
  private readonly lastFiredStore: ScheduleStateStore
  private readonly channelId: string | null
  private readonly logger: FunnelLogger | undefined
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private readonly now: () => Date
  private readonly onFired: ScheduleOnFired | null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private tickScheduled = false

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.lastFiredStore = deps.lastFiredStore
    this.channelId = deps.channelId ?? null
    this.logger = deps.logger
    this.diagnosticLog = deps.diagnosticLog
    this.now = deps.now ?? (() => new Date())
    this.onFired = deps.onFired ?? null
  }

  async start(notify: NotifyFn): Promise<void> {
    this.stopped = false
    this.tickScheduled = true

    this.recordConnection("started", "")

    const scheduleNext = () => {
      if (this.stopped) return

      const date = this.now()
      const msUntilNextMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
      this.timer = setTimeout(async () => {
        if (this.stopped) return

        try {
          await this.tick(notify)
        } catch (error) {
          this.logger?.error("schedule tick failed", {
            connector: this.config.name,
            error: errorMessageOf(error),
          })
        }

        scheduleNext()
      }, msUntilNextMinute)

      this.timer.unref()
      this.tickScheduled = true
    }

    try {
      await this.tick(notify)
    } catch (error) {
      this.logger?.error("schedule tick failed", {
        connector: this.config.name,
        error: errorMessageOf(error),
      })
    }

    scheduleNext()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.tickScheduled = false

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.recordConnection("stopped", "")
  }

  override isAlive(): boolean {
    return !this.stopped && this.tickScheduled
  }

  async tick(notify: NotifyFn): Promise<void> {
    const now = this.truncateToMinute(this.now())
    const state = this.lastFiredStore.load()
    let changed = false

    for (const entry of this.config.entries) {
      if (!entry.enabled) continue

      const fired = await this.fireEntry(entry, now, state, notify)

      if (fired) changed = true
    }

    if (changed) this.lastFiredStore.save(state)
  }

  private async fireEntry(
    entry: ScheduleEntry,
    now: Date,
    state: Map<string, Date>,
    notify: NotifyFn,
  ): Promise<boolean> {
    const lastFired = state.get(entry.id)
    const searchFrom = lastFired ? new Date(lastFired.getTime() + 60_000) : now

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

      if (matches.length === 0) return false

      for (const match of matches) {
        await this.notifyOne(entry, match, notify, match.getTime() !== now.getTime())
      }

      state.set(entry.id, matches[matches.length - 1] ?? now)
      return true
    }

    const match = this.findMostRecentMatch(entry.cron, searchFrom, now, entry.id)

    if (!match) return false

    await this.notifyOne(entry, match, notify, match.getTime() !== now.getTime())
    state.set(entry.id, match)
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
      cron: entry.cron,
      fired_at: firedAt.toISOString(),
      catchup_policy: entry.catchupPolicy,
    }

    if (catchup) meta.catchup = "true"

    // A fire is this connector's "inbound event". The id pairs the entry with
    // the exact firing time so catch-up fires of one entry stay distinct.
    const eventId = `${entry.id}@${firedAt.toISOString()}`

    this.recordRaw(eventId, entry, firedAt, catchup)

    try {
      await notify(entry.prompt, meta)
    } catch (error) {
      this.recordProcessed(eventId, entry, "emitted:delivery-failed")
      throw error
    }

    this.recordProcessed(eventId, entry, "emitted")

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
        this.logInvalidCron({ id: entryId, cron } as ScheduleEntry, error)
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
        this.logInvalidCron({ id: entryId, cron } as ScheduleEntry, error)
        return []
      }
    }

    return matches
  }

  private logInvalidCron(entry: Pick<ScheduleEntry, "id" | "cron">, error: unknown): void {
    const message = errorMessageOf(error)

    this.recordConnection("error", `invalid cron "${entry.cron}" (entry ${entry.id}): ${message}`)
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

  private recordRaw(eventId: string, entry: ScheduleEntry, firedAt: Date, catchup: boolean): void {
    this.diagnosticLog?.recordRaw({
      eventId,
      type: "schedule",
      connectorId: this.config.id,
      channelId: this.channelId,
      payload: JSON.stringify({
        schedule_id: entry.id,
        cron: entry.cron,
        prompt: entry.prompt,
        fired_at: firedAt.toISOString(),
        catchup,
      }),
    })
  }

  private recordProcessed(eventId: string, entry: ScheduleEntry, outcome: string): void {
    this.diagnosticLog?.recordProcessed({
      eventId,
      type: "schedule",
      connectorId: this.config.id,
      channelId: this.channelId,
      outcome,
      payload: entry.prompt,
    })
  }

  private recordConnection(status: ConnectorConnectionStatus, detail: string): void {
    this.diagnosticLog?.recordConnection({
      type: "schedule",
      connectorId: this.config.id,
      channelId: this.channelId,
      status,
      detail,
    })
  }
}
