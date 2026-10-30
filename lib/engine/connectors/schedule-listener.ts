import {
  DUPLICATE_SCHEDULE_ENTRY_ID,
  hasUniqueScheduleEntryIds,
} from "@/engine/connectors/schedule-entry-ids"
import { listenerSignal } from "@/engine/connectors/listener-signal"
import { snapshotScheduleState } from "@/engine/connectors/schedule-state-snapshot"
import { requireTimestamp } from "@/require-timestamp"
import { requireSynchronous } from "@/require-synchronous"
import { invokeCallback } from "@/invoke-callback"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { matchCron } from "@/engine/connectors/match-cron"
import type { ScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { FunnelConnectorDiagnosticsRecorder } from "@/engine/connectors/connector-diagnostics-recorder"
import { FunnelLogger } from "@/engine/logger/logger"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type {
  CronScheduleEntry,
  ScheduleConnectorConfig,
  ScheduleEntry,
} from "@/engine/connectors/schedule-connector-schema"

/** Detached entry and Date snapshots let observers transform values without changing later fires. */
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
  signal?: AbortSignal
}

const MAX_CATCHUP_MINUTES = 60 * 24

export class FunnelScheduleListener extends FunnelConnectorListener {
  private readonly config: ScheduleConnectorConfig
  private readonly lastFiredStore: ScheduleStateStore
  private readonly logger: FunnelLogger | undefined
  private readonly diagnostics: FunnelConnectorDiagnosticsRecorder
  private readonly now: () => Date
  private readonly onFired: ScheduleOnFired | null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private tickScheduled = false
  private tickCompletion: Promise<void> | null = null
  private run = 0
  private readonly signal: AbortSignal | undefined
  private abortBinding: { signal: AbortSignal; abort: () => void } | null = null

  constructor(deps: Deps) {
    super()
    const config = deps.config
    this.config = {
      id: config.id,
      name: config.name,
      type: config.type,
      entries: config.entries.map((entry) => this.snapshotEntry(entry)),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }
    if (!hasUniqueScheduleEntryIds(this.config.entries))
      throw new Error(DUPLICATE_SCHEDULE_ENTRY_ID)
    this.lastFiredStore = deps.lastFiredStore
    this.logger = deps.logger
    this.diagnostics = new FunnelConnectorDiagnosticsRecorder({
      type: "schedule",
      connectorId: this.config.id,
      channelId: deps.channelId ?? null,
      log: deps.diagnosticLog,
    })
    this.now = deps.now ?? (() => new Date())
    this.onFired = deps.onFired ?? null
    this.signal = deps.signal
  }

  async start(notify: NotifyFn, startupSignal?: AbortSignal): Promise<void> {
    const signal = listenerSignal(this.signal, startupSignal)
    signal?.throwIfAborted()
    if (this.isAlive()) throw new Error("schedule listener is already started")
    const run = ++this.run
    const isCurrent = () => this.isCurrent(run)
    this.stopped = false
    this.tickScheduled = true
    if (signal) {
      const abort = () => {
        if (isCurrent()) invokeCallback(() => this.stop())
      }
      this.abortBinding = { signal, abort }
      signal.addEventListener("abort", abort, { once: true })
    }

    this.observeDiagnostic(() => this.diagnostics.recordConnection("started", ""))

    const scheduleNext = () => {
      if (!isCurrent()) return
      let date: Date
      try {
        date = this.readNow()
      } catch (error) {
        this.stopRun(run)
        throw error
      }
      if (!isCurrent()) return
      const msUntilNextMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds())
      this.timer = setTimeout(async () => {
        if (!isCurrent()) return
        this.timer = null
        try {
          await this.tick(notify)
        } catch (error) {
          this.recordTickError(error)
        }
        try {
          scheduleNext()
        } catch (error) {
          this.recordTickError(error)
        }
      }, msUntilNextMinute)
      this.timer.unref()
    }

    const connect = async () => {
      if (!isCurrent()) return
      try {
        await this.tick(notify)
      } catch (error) {
        this.recordTickError(error)
      }
      if (!isCurrent()) return
      scheduleNext()
      if (isCurrent())
        this.observeDiagnostic(() => this.diagnostics.recordConnection("connected", ""))
    }

    // A stop/restart can be requested from inside notify/onFired. Do not wait
    // for that callback here: defer this run's first tick until it unwinds.
    const pending = this.tickCompletion
    if (pending) {
      invokeCallback(
        () => pending.then(connect),
        (error) => this.recordTickError(error),
      )
      signal?.throwIfAborted()
      return
    }
    try {
      await connect()
    } catch (error) {
      this.recordTickError(error)
      throw error
    }
    signal?.throwIfAborted()
  }

  async stop(): Promise<void> {
    this.stopRun(this.run)
    this.observeDiagnostic(() => this.diagnostics.recordConnection("disconnected", ""))
    this.observeDiagnostic(() => this.diagnostics.recordConnection("stopped", ""))
  }

  private isCurrent(run: number): boolean {
    return !this.stopped && run === this.run
  }

  private stopRun(run: number): void {
    if (run !== this.run) return
    this.run++
    this.stopped = true
    this.tickScheduled = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.abortBinding) {
      this.abortBinding.signal.removeEventListener("abort", this.abortBinding.abort)
      this.abortBinding = null
    }
  }

  private observeDiagnostic(callback: () => unknown): void {
    invokeCallback(callback, (error) =>
      this.logger?.error("schedule diagnostic callback failed", {
        connector: this.config.name,
        error: errorMessageOf(error),
      }),
    )
  }

  private recordTickError(error: unknown): void {
    const message = errorMessageOf(error)
    this.observeDiagnostic(() => this.diagnostics.recordConnection("error", `tick: ${message}`))
    invokeCallback(() =>
      this.logger?.error("schedule tick failed", {
        connector: this.config.name,
        error: message,
      }),
    )
  }

  override isAlive(): boolean {
    return !this.stopped && this.tickScheduled
  }

  async tick(notify: NotifyFn): Promise<void> {
    if (this.stopped || this.tickCompletion) return
    const completion = Promise.withResolvers<void>()
    this.tickCompletion = completion.promise
    const run = this.run
    try {
      await this.tickEntries(notify, run)
    } finally {
      this.tickCompletion = null
      completion.resolve()
    }
  }

  private async tickEntries(notify: NotifyFn, run: number): Promise<void> {
    const now = this.truncateToMinute(this.readNow())
    const state = snapshotScheduleState(
      requireSynchronous(
        this.lastFiredStore.load(),
        "schedule state load must be synchronous",
        (error) => this.recordTickError(error),
      ),
    )
    if (!this.isCurrent(run)) return
    if (this.pruneRemovedEntries(state)) this.saveState(state)

    for (const entry of this.config.entries) {
      if (!this.isCurrent(run)) break
      if (!entry.enabled) continue

      await this.fireEntry(entry, now, state, notify, run)
    }
  }

  private async fireEntry(
    entry: ScheduleEntry,
    now: Date,
    state: Map<string, Date>,
    notify: NotifyFn,
    run: number,
  ): Promise<boolean> {
    if (entry.kind === "once") {
      return this.fireOnceEntry(entry, now, state, notify, run)
    }

    return this.fireCronEntry(entry, now, state, notify, run)
  }

  private async fireOnceEntry(
    entry: Extract<ScheduleEntry, { kind: "once" }>,
    now: Date,
    state: Map<string, Date>,
    notify: NotifyFn,
    run: number,
  ): Promise<boolean> {
    if (state.has(entry.id)) return false

    const runAt = new Date(entry.runAt)
    if (now.getTime() < runAt.getTime()) return false

    const lateness = now.getTime() - runAt.getTime()

    if (entry.catchupPolicy === "skip" && lateness >= 60_000) {
      state.set(entry.id, runAt)
      this.saveState(state)
      return true
    }

    await this.notifyOne({ entry, firedAt: runAt, notify, catchup: lateness > 0, state, run })
    return true
  }

  private async fireCronEntry(
    entry: CronScheduleEntry,
    now: Date,
    state: Map<string, Date>,
    notify: NotifyFn,
    run: number,
  ): Promise<boolean> {
    const lastFired = state.get(entry.id)
    const createdAt = entry.createdAt ? this.truncateToMinute(new Date(entry.createdAt)) : now
    const searchFrom = lastFired
      ? this.adjacentMinute(this.truncateToMinute(lastFired), 1)
      : createdAt

    if (!Number.isFinite(searchFrom.getTime()) || searchFrom.getTime() > now.getTime()) return false

    if (entry.catchupPolicy === "skip") {
      try {
        if (!matchCron(entry.cron, now)) return false
      } catch (error) {
        this.logInvalidCron(entry, error)
        return false
      }

      await this.notifyOne({ entry, firedAt: now, notify, catchup: false, state, run })
      return true
    }

    if (entry.catchupPolicy === "all") {
      const matches = this.findAllMatches(entry.cron, searchFrom, now, entry.id)

      if (matches.length === 0) return this.seedSearchWatermark(entry.id, lastFired, now, state)

      for (const match of matches) {
        if (!this.isCurrent(run)) break
        await this.notifyOne({
          entry,
          firedAt: match,
          notify,
          catchup: match.getTime() !== now.getTime(),
          state,
          run,
        })
      }

      return true
    }

    const match = this.findMostRecentMatch(entry.cron, searchFrom, now, entry.id)

    if (!match) return this.seedSearchWatermark(entry.id, lastFired, now, state)

    await this.notifyOne({
      entry,
      firedAt: match,
      notify,
      catchup: match.getTime() !== now.getTime(),
      state,
      run,
    })
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
    this.saveState(state)
    return true
  }

  private async notifyOne(props: {
    entry: ScheduleEntry
    firedAt: Date
    notify: NotifyFn
    catchup: boolean
    state: Map<string, Date>
    run: number
  }): Promise<void> {
    if (!this.isCurrent(props.run)) return
    const entry = props.entry
    const firedAt = props.firedAt
    const catchup = props.catchup
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

    this.observeDiagnostic(() =>
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
      ),
    )

    if (!this.isCurrent(props.run)) return
    try {
      await props.notify(entry.prompt, meta)
    } catch (error) {
      this.observeDiagnostic(() =>
        this.diagnostics.recordProcessed(eventId, "emitted:delivery-failed", entry.prompt),
      )
      throw error
    }

    // Preserve successful delivery even if a later fire or host callback fails.
    props.state.set(entry.id, firedAt)
    this.saveState(props.state)
    this.observeDiagnostic(() => this.diagnostics.recordProcessed(eventId, "emitted", entry.prompt))

    if (this.onFired) {
      try {
        await this.onFired(this.snapshotEntry(entry), new Date(firedAt.getTime()))
      } catch (error) {
        invokeCallback(() =>
          this.logger?.error("schedule onFired callback failed", {
            connector: this.config.name,
            id: entry.id,
            error: errorMessageOf(error),
          }),
        )
      }
    }
  }

  private saveState(state: ReadonlyMap<string, Date>): void {
    requireSynchronous(
      this.lastFiredStore.save(snapshotScheduleState(state)),
      "schedule state save must be synchronous",
      (error) => this.recordTickError(error),
    )
  }

  private findMostRecentMatch(cron: string, from: Date, until: Date, entryId: string): Date | null {
    const searchStart = Math.max(
      from.getTime(),
      until.getTime() - (MAX_CATCHUP_MINUTES - 1) * 60_000,
    )

    for (
      let candidate = until;
      candidate.getTime() >= searchStart;
      candidate = this.adjacentMinute(candidate, -1)
    ) {
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
    const searchStart = Math.max(
      from.getTime(),
      until.getTime() - (MAX_CATCHUP_MINUTES - 1) * 60_000,
    )
    const matches: Date[] = []
    let first = this.truncateToMinute(new Date(searchStart))
    if (first.getTime() < searchStart) first = this.adjacentMinute(first, 1)

    for (
      let candidate = first;
      candidate.getTime() <= until.getTime();
      candidate = this.adjacentMinute(candidate, 1)
    ) {
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

    this.observeDiagnostic(() =>
      this.diagnostics.recordConnection(
        "error",
        `invalid cron "${entry.cron}" (entry ${entry.id}): ${message}`,
      ),
    )
    invokeCallback(() =>
      this.logger?.error("invalid cron expression in schedule", {
        connector: this.config.name,
        id: entry.id,
        cron: entry.cron,
        error: message,
      }),
    )
  }

  private snapshotEntry(entry: ScheduleEntry): ScheduleEntry {
    const base = {
      id: entry.id,
      prompt: entry.prompt,
      enabled: entry.enabled,
      catchupPolicy: entry.catchupPolicy,
      createdAt: entry.createdAt,
    }
    return entry.kind === "once"
      ? { ...base, kind: "once", runAt: entry.runAt }
      : { ...base, kind: "cron", cron: entry.cron }
  }

  private readNow(): Date {
    const date = requireSynchronous(this.now(), "clock now must be synchronous")
    return new Date(requireTimestamp(date.getTime()))
  }

  private truncateToMinute(date: Date): Date {
    // Local setters can choose an earlier occurrence of an ambiguous DST hour.
    const timestamp = requireTimestamp(date.getTime())
    const rounded = timestamp - date.getSeconds() * 1000 - date.getMilliseconds()
    const candidate = new Date(requireTimestamp(rounded))
    if (candidate.getSeconds() === 0) return candidate
    // A historical offset transition can place the tentative floor in a
    // different second phase. Find the actual preceding local minute instead.
    return this.seekMinute(timestamp - date.getMilliseconds(), -1)
  }

  private adjacentMinute(date: Date, direction: 1 | -1): Date {
    const candidate = new Date(date.getTime() + direction * 60_000)
    if (!Number.isFinite(candidate.getTime()) || candidate.getSeconds() === 0) return candidate
    // UTC minute steps preserve local boundaries until an offset changes seconds.
    return this.seekMinute(date.getTime() + direction * 1000, direction)
  }

  private seekMinute(timestamp: number, direction: 1 | -1): Date {
    let candidate = new Date(timestamp)
    while (Number.isFinite(candidate.getTime()) && candidate.getSeconds() !== 0) {
      timestamp += direction * 1000
      candidate = new Date(timestamp)
    }
    return candidate
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
