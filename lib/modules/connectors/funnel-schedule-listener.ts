import {
  FunnelConnectorListener,
  type NotifyFn,
} from "@/modules/connectors/funnel-connector-listener"
import { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import { matchCron } from "@/modules/connectors/match-cron"
import { ScheduleLastFiredStore } from "@/modules/connectors/schedule-last-fired-store"
import { logger } from "@/modules/logger"
import type { ScheduleConnectorConfig } from "@/modules/connectors/schedule-connector-schema"

type Deps = {
  config: ScheduleConnectorConfig
  store: FunnelScheduleStore
  lastFiredStore: ScheduleLastFiredStore
  now?: () => Date
}

const MAX_CATCHUP_MINUTES = 60 * 24

export class FunnelScheduleListener extends FunnelConnectorListener {
  private readonly config: ScheduleConnectorConfig
  private readonly store: FunnelScheduleStore
  private readonly lastFiredStore: ScheduleLastFiredStore
  private readonly now: () => Date

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.store = deps.store
    this.lastFiredStore = deps.lastFiredStore
    this.now = deps.now ?? (() => new Date())
    Object.freeze(this)
  }

  async start(notify: NotifyFn): Promise<void> {
    const scheduleNext = () => {
      const date = this.now()
      const msUntilNextMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
      const timer = setTimeout(async () => {
        await this.tick(notify)
        scheduleNext()
      }, msUntilNextMinute)

      timer.unref()
    }

    await this.tick(notify)
    scheduleNext()
  }

  async tick(notify: NotifyFn): Promise<void> {
    const config = this.store.get(this.config.name)

    if (!config) return

    const now = this.truncateToMinute(this.now())
    const state = this.lastFiredStore.load()
    let changed = false

    for (const entry of config.entries) {
      if (!entry.enabled) continue

      const lastFired = state.get(entry.id)
      const searchFrom = lastFired ? new Date(lastFired.getTime() + 60_000) : now

      if (searchFrom.getTime() > now.getTime()) continue

      const match = this.findMostRecentMatch(entry.cron, searchFrom, now, entry.id)

      if (!match) continue

      const meta: Record<string, string> = {
        event_type: "schedule",
        schedule_id: entry.id,
        cron: entry.cron,
        fired_at: match.toISOString(),
      }

      if (match.getTime() !== now.getTime()) meta.catchup = "true"

      await notify(entry.prompt, meta)
      state.set(entry.id, match)
      changed = true
    }

    if (changed) this.lastFiredStore.save(state)
  }

  private findMostRecentMatch(
    cron: string,
    from: Date,
    until: Date,
    entryId: string,
  ): Date | null {
    const maxIterations = Math.min(
      MAX_CATCHUP_MINUTES,
      Math.floor((until.getTime() - from.getTime()) / 60_000) + 1,
    )

    for (let i = 0; i < maxIterations; i++) {
      const candidate = new Date(until.getTime() - i * 60_000)

      try {
        if (matchCron(cron, candidate)) return candidate
      } catch (error) {
        logger.error("invalid cron expression in schedule", {
          connector: this.config.name,
          id: entryId,
          cron,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    }

    return null
  }

  private truncateToMinute(date: Date): Date {
    const copy = new Date(date.getTime())
    copy.setSeconds(0, 0)
    return copy
  }
}
