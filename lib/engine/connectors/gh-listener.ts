import { z } from "zod"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { FunnelLogger } from "@/engine/logger/logger"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import type {
  ConnectorConnectionStatus,
  ConnectorDiagnosticLog,
} from "@/engine/diagnostic-log/diagnostic-log"
import type { GhConnectorConfig } from "@/engine/connectors/gh-connector-schema"

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
})

const ghNotificationsSchema = z.array(ghNotificationSchema)

type GhNotification = z.infer<typeof ghNotificationSchema>

type Deps = {
  config: GhConnectorConfig
  /** Funnel channel uuid this connector lives under; stamped onto diagnostic-log rows. */
  channelId?: string
  process?: FunnelProcessRunner
  logger?: FunnelLogger
  /** Diagnostic log of inbound events, before and after processing. No-op when absent. */
  diagnosticLog?: ConnectorDiagnosticLog
  now?: () => Date
}

const defaultProcess = new NodeFunnelProcessRunner()

const MAX_SEEN = 10000
const KEEP_SEEN = 5000

export class FunnelGhListener extends FunnelConnectorListener {
  private readonly config: GhConnectorConfig
  private readonly channelId: string | null
  private readonly process: FunnelProcessRunner
  private readonly logger: FunnelLogger | undefined
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private readonly now: () => Date
  private readonly seen = new Map<string, string>()
  private bootstrapped = false
  private since: string
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.channelId = deps.channelId ?? null
    this.process = deps.process ?? defaultProcess
    this.logger = deps.logger
    this.diagnosticLog = deps.diagnosticLog
    this.now = deps.now ?? (() => new Date())
    this.since = this.now().toISOString()
  }

  async start(notify: NotifyFn): Promise<void> {
    this.recordConnection("started", "")

    await this.pollOnce(notify)

    const interval = this.config.pollInterval ?? 60

    this.timer = setInterval(() => void this.pollOnce(notify), interval * 1000)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    if (!this.timer) return

    clearInterval(this.timer)
    this.timer = null
    this.recordConnection("stopped", "")
  }

  override isAlive(): boolean {
    return this.timer !== null
  }

  async pollOnce(notify: NotifyFn): Promise<void> {
    const nextSince = this.now().toISOString()
    const params = new URLSearchParams({ since: this.since, all: "false" })

    try {
      const result = await this.process.run(["gh", "api", `/notifications?${params}`])

      if (result.exitCode !== 0) {
        this.recordConnection("error", `gh api exited ${result.exitCode}: ${result.stderr}`)
        this.logger?.error("gh poll failed", { stderr: result.stderr })
        return
      }

      const parsed = ghNotificationsSchema.safeParse(JSON.parse(result.stdout))

      if (!parsed.success) {
        this.recordConnection("error", `gh response schema mismatch: ${parsed.error.message}`)
        this.logger?.warn("gh response did not match schema", { error: parsed.error.message })
        return
      }

      // A clean poll means the gh CLI is authenticated and reachable. Record
      // the first one as the "connected" milestone for this listener.
      if (!this.bootstrapped) this.recordConnection("connected", "")

      const items: GhNotification[] = parsed.data

      for (const item of items) {
        if (this.seen.get(item.id) === item.updated_at) continue

        this.seen.set(item.id, item.updated_at)

        // A notification's id is stable across polls, so it is the correlation
        // key tying this raw row to its processed verdict.
        this.recordRaw(item.id, item)

        if (!this.bootstrapped) {
          // Pre-bootstrap items are the initial backlog we deliberately do not
          // deliver; record why so the absence of a notification is explained.
          this.recordProcessed(item.id, item, "skip:bootstrap", "")
          continue
        }

        const meta: Record<string, string> = {
          event_type: "gh",
          reason: item.reason,
          subject_type: item.subject.type,
          subject_url: item.subject.url,
          repository: item.repository.full_name,
          thread_id: item.id,
          updated_at: item.updated_at,
        }

        const content = JSON.stringify(item)

        try {
          await notify(content, meta)
        } catch (error) {
          this.recordProcessed(item.id, item, "emitted:delivery-failed", content)
          throw error
        }

        this.recordProcessed(item.id, item, "emitted", content)
      }

      if (this.seen.size > MAX_SEEN) {
        const toDrop = this.seen.size - KEEP_SEEN
        let dropped = 0

        for (const key of this.seen.keys()) {
          if (dropped >= toDrop) break
          this.seen.delete(key)
          dropped++
        }
      }

      this.since = nextSince
      this.bootstrapped = true
    } catch (error) {
      // Lands here on process spawn failures, JSON.parse errors, and notify
      // throws. Recording the connection row keeps these visible to
      // diagnostics alongside the gh-api / schema failures recorded above.
      this.recordConnection("error", errorMessageOf(error))
      this.logger?.error("gh poll error", {
        error: errorMessageOf(error),
      })
    }
  }

  private recordRaw(eventId: string, item: GhNotification): void {
    this.diagnosticLog?.recordRaw({
      eventId,
      type: "gh",
      connectorId: this.config.id,
      channelId: this.channelId,
      payload: JSON.stringify(item),
    })
  }

  private recordProcessed(
    eventId: string,
    item: GhNotification,
    outcome: string,
    content: string,
  ): void {
    this.diagnosticLog?.recordProcessed({
      eventId,
      type: "gh",
      connectorId: this.config.id,
      channelId: this.channelId,
      outcome,
      payload: content || JSON.stringify(item),
    })
  }

  private recordConnection(status: ConnectorConnectionStatus, detail: string): void {
    this.diagnosticLog?.recordConnection({
      type: "gh",
      connectorId: this.config.id,
      channelId: this.channelId,
      status,
      detail,
    })
  }
}
