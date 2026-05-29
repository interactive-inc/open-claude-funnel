import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener"
import { matchCron } from "@/connectors/match-cron"
import { ScheduleStateStore } from "@/connectors/schedule-state-store"
import { FunnelLogger } from "@/engine/logger/logger"
import type { ScheduleConnectorConfig, ScheduleEntry } from "@/connectors/schedule-connector-schema"

export type ScheduleOnFired = (entry: ScheduleEntry, firedAt: Date) => void | Promise<void>

type Deps = {
  config: ScheduleConnectorConfig
  lastFiredStore: ScheduleStateStore
  logger?: FunnelLogger
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
  private readonly logger: FunnelLogger | undefined
  private readonly now: () => Date
  private readonly onFired: ScheduleOnFired | null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.lastFiredStore = deps.lastFiredStore
    this.logger = deps.logger
    this.now = deps.now ?? (() => new Date())
    this.onFired = deps.onFired ?? null
  }

  async start(notify: NotifyFn): Promise<void> {
    this.stopped = false

    const scheduleNext = () => {
      if (this.stopped) return

      const date = this.now()
      const msUntilNextMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
      this.timer = setTimeout(async () => {
        if (this.stopped) return
        await this.tick(notify)
        scheduleNext()
      }, msUntilNextMinute)

      this.timer.unref()
    }

    await this.tick(notify)
    scheduleNext()
  }

  async stop(): Promise<void> {
    this.stopped = true

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  override isAlive(): boolean {
    return !this.stopped && this.timer !== null
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
    const searchFrom = lastFired
      ? new Date(lastFired.getTime() + 60_000)
      : new Date(now.getTime() - MAX_CATCHUP_MINUTES * 60_000)

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

    await notify(entry.prompt, meta)

    if (this.onFired) {
      try {
        await this.onFired(entry, firedAt)
      } catch (error) {
        this.logger?.error("schedule onFired callback failed", {
          connector: this.config.name,
          id: entry.id,
          error: error instanceof Error ? error.message : String(error),
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
    this.logger?.error("invalid cron expression in schedule", {
      connector: this.config.name,
      id: entry.id,
      cron: entry.cron,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  private truncateToMinute(date: Date): Date {
    const copy = new Date(date.getTime())
    copy.setSeconds(0, 0)
    return copy
  }
}
