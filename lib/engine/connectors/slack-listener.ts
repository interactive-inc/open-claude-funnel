import { App, LogLevel } from "@slack/bolt"
import { z } from "zod"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import {
  FunnelSlackEventProcessor,
  type SlackRawEvent,
} from "@/engine/connectors/slack-event-processor"
import { FunnelLogger } from "@/engine/logger/logger"
import type {
  ConnectorConnectionStatus,
  ConnectorDiagnosticLog,
} from "@/gateway/diagnostic-log/diagnostic-log"
import type { SlackConnectorConfig } from "@/engine/connectors/slack-connector-schema"

const middlewareArgsSchema = z.object({
  event: z.record(z.string(), z.unknown()).optional(),
})

export type SlackOnAppCreated = (app: App) => void | Promise<void>
export type SlackPreprocessEvent = (event: SlackRawEvent) => SlackRawEvent | null

type Deps = {
  config: SlackConnectorConfig
  /** Funnel channel uuid this connector lives under; stamped onto diagnostic-log rows. */
  channelId?: string
  /** Environment used to resolve `botTokenEnv`/`appTokenEnv` references. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
  logger?: FunnelLogger
  /** Diagnostic log of inbound events, before and after processing. No-op when absent. */
  diagnosticLog?: ConnectorDiagnosticLog
  /**
   * Invoked after the Bolt App is constructed, before it starts.
   * Use to attach app.action handlers, custom middleware, etc.
   */
  onAppCreated?: SlackOnAppCreated
  /**
   * Transform or drop the raw Slack event before the built-in processor sees it.
   * Return null to drop the event entirely.
   */
  preprocessEvent?: SlackPreprocessEvent
}

export class FunnelSlackListener extends FunnelConnectorListener {
  private readonly config: SlackConnectorConfig
  private readonly channelId: string | null
  private readonly env: NodeJS.ProcessEnv
  private readonly logger: FunnelLogger | undefined
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private readonly onAppCreated: SlackOnAppCreated | null
  private readonly preprocessEvent: SlackPreprocessEvent | null
  private app: App | null = null
  // Tracks live Socket Mode connectivity. `this.app` only records "did we ever
  // start"; it stays non-null after the socket dies. @slack/socket-mode handles
  // recoverable disconnects internally and only surfaces a NON-recoverable
  // failure (invalid_auth, a RequestError refreshing the WSS URL, …) to
  // `app.error`, at which point it stops reconnecting. Flipping this false there
  // is what lets the supervisor's health check see the listener as dead and
  // restart it — without it, a dead socket reads as alive forever.
  private connected = false

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.channelId = deps.channelId ?? null
    this.env = deps.env ?? process.env
    this.logger = deps.logger
    this.diagnosticLog = deps.diagnosticLog
    this.onAppCreated = deps.onAppCreated ?? null
    this.preprocessEvent = deps.preprocessEvent ?? null
  }

  async start(notify: NotifyFn): Promise<void> {
    this.recordConnection("started", "")

    const botToken = resolveConnectorToken({
      literal: this.config.botToken,
      envVar: this.config.botTokenEnv,
      env: this.env,
      label: `${this.config.name}.botToken`,
    })
    const appToken = resolveConnectorToken({
      literal: this.config.appToken,
      envVar: this.config.appTokenEnv,
      env: this.env,
      label: `${this.config.name}.appToken`,
    })

    const app = new App({
      token: botToken,
      appToken,
      socketMode: true,
      logLevel: LogLevel.ERROR,
    })

    let authResult: Awaited<ReturnType<typeof app.client.auth.test>>

    try {
      authResult = await app.client.auth.test({ token: botToken })
    } catch (error) {
      // A bad/expired token surfaces here, before the socket opens — the most
      // common "no events ever arrive" cause. Record it so it is visible in
      // the connection table, then let the supervisor see the failure.
      this.recordConnection("auth-failed", messageOf(error))
      throw error
    }

    const processor = new FunnelSlackEventProcessor({
      ownBotUserId: authResult.user_id ?? "",
      ownBotId: authResult.bot_id ?? "",
      minify: this.config.minify,
    })

    const preprocess = this.preprocessEvent

    app.use(async (args) => {
      const parsed = middlewareArgsSchema.safeParse(args)

      // Only events are funnel's concern. Payloads without an `event` key
      // (block_actions, view_submission, slash commands, …) must fall through
      // to the listeners registered via onAppCreated — call next() instead of
      // swallowing them, or app.action handlers (e.g. approval buttons) never
      // fire. This middleware consumes events and lets everything else pass.
      if (!parsed.success || !parsed.data.event) {
        await args.next()
        return
      }

      const rawEvent = parsed.data.event as SlackRawEvent

      // One id per inbound event, shared by its raw and processed rows so the
      // two are joinable across the separate diagnostic tables.
      const eventId = crypto.randomUUID()

      // Record the untouched Bolt event before any filtering or host
      // preprocessing — this is the ground truth for "did Slack actually
      // deliver it?". Everything dropped downstream still has a raw row.
      this.recordRaw(eventId, rawEvent)

      const event = preprocess ? preprocess(rawEvent) : rawEvent

      if (event === null) {
        this.recordProcessed(eventId, rawEvent, "skip:preprocess", "")
        return
      }

      const result = processor.process(event)

      if (result.skip) {
        this.recordProcessed(eventId, event, result.reason, "")
        return
      }

      // Record the verdict only after delivery resolves, and reflect a failed
      // delivery as its own outcome — recording "emitted" before notify would
      // leave a row claiming success for a message that never arrived, exactly
      // the case this diagnostic log exists to catch.
      try {
        await notify(result.content, result.meta)
      } catch (error) {
        this.recordProcessed(eventId, event, "emitted:delivery-failed", result.content)
        throw error
      }

      this.recordProcessed(eventId, event, "emitted", result.content)

      // Only reached when notify resolved, so an undelivered message is never
      // marked seen with the eyes reaction.
      if (result.shouldReact) {
        try {
          await app.client.reactions.add({
            token: botToken,
            channel: result.channel,
            timestamp: result.timestamp,
            name: "eyes",
          })
        } catch {
          // ignore
        }
      }
    })

    app.error(async (error) => {
      const message = messageOf(error)
      // A non-recoverable Socket Mode error reaches here after the client has
      // given up reconnecting, so treat the listener as disconnected. The
      // supervisor's next health check then restarts it (stop → backoff →
      // start), which re-runs auth.test and reopens the socket.
      this.connected = false
      this.recordConnection("error", message)
      this.logger?.error("Slack error", { error: message })
    })

    if (this.onAppCreated) await this.onAppCreated(app)

    try {
      await app.start()
    } catch (error) {
      this.recordConnection("error", messageOf(error))
      throw error
    }

    this.app = app
    this.connected = true
    this.recordConnection("connected", "")
  }

  async stop(): Promise<void> {
    if (!this.app) return

    try {
      await this.app.stop()
      this.recordConnection("disconnected", "")
    } catch (error) {
      this.recordConnection("error", messageOf(error))
      this.logger?.error("Slack stop error", { error: messageOf(error) })
    } finally {
      this.app = null
      this.connected = false
      this.recordConnection("stopped", "")
    }
  }

  override isAlive(): boolean {
    return this.app !== null && this.connected
  }

  private recordRaw(eventId: string, event: SlackRawEvent): void {
    this.diagnosticLog?.recordRaw({
      eventId,
      type: "slack",
      connectorId: this.config.id,
      channelId: this.channelId,
      payload: JSON.stringify(event),
    })
  }

  private recordProcessed(
    eventId: string,
    event: SlackRawEvent,
    outcome: string,
    content: string,
  ): void {
    this.diagnosticLog?.recordProcessed({
      eventId,
      type: "slack",
      connectorId: this.config.id,
      channelId: this.channelId,
      outcome,
      payload: content || JSON.stringify(event),
    })
  }

  private recordConnection(status: ConnectorConnectionStatus, detail: string): void {
    this.diagnosticLog?.recordConnection({
      type: "slack",
      connectorId: this.config.id,
      channelId: this.channelId,
      status,
      detail,
    })
  }
}

const messageOf = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error)
}
