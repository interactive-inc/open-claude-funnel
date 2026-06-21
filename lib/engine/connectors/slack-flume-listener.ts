import { FlumeSlackSource, FlumeSlackEnvelopeSchema } from "@interactive-inc/flume/slack"
import type { FlumeEvent, FlumeRuntimeDeps, FlumeStatus } from "@interactive-inc/flume"
import { z } from "zod"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import {
  FunnelSlackEventProcessor,
  type SlackRawEvent,
} from "@/engine/connectors/slack-event-processor"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import { flumeLogHandler, flumeRuntimeDeps } from "@/engine/connectors/flume-deps"
import { FunnelConnectorDiagnosticsRecorder } from "@/engine/connectors/connector-diagnostics-recorder"
import { FunnelLogger } from "@/engine/logger/logger"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { SlackConnectorConfig } from "@/engine/connectors/slack-connector-schema"

type Deps = {
  config: SlackConnectorConfig
  channelId?: string
  env?: NodeJS.ProcessEnv
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  flumeDeps?: Partial<FlumeRuntimeDeps>
}

const authTestResponseSchema = z.object({
  ok: z.boolean(),
  user_id: z.string().optional(),
  bot_id: z.string().optional(),
  error: z.string().optional(),
})

const AUTH_TEST_URL = "https://slack.com/api/auth.test"

/**
 * Slack listener backed by `@interactive-inc/flume`'s `FlumeSlackSource` (raw
 * Socket Mode WebSocket + Zod). The processor layer
 * (`FunnelSlackEventProcessor`) is the application layer — self-skip, mention
 * detection, dedup, minify. Self-detection needs `auth.test` to learn the
 * bot's own user/bot id, which the listener calls once at start using the
 * bot token. Flume delivers the events API envelope and nothing else; Bolt's
 * `app.action` / `app.command` / `preprocessEvent` hooks have no equivalent
 * here and must be re-implemented against Slack's HTTP endpoints if needed.
 */
export class FunnelFlumeSlackListener extends FunnelConnectorListener {
  private readonly config: SlackConnectorConfig
  private readonly env: NodeJS.ProcessEnv
  private readonly logger: FunnelLogger | undefined
  private readonly flumeDeps: Partial<FlumeRuntimeDeps>
  private readonly diagnostics: FunnelConnectorDiagnosticsRecorder
  private source: FlumeSlackSource | null = null
  private processor: FunnelSlackEventProcessor | null = null
  private botToken = ""
  private connected = false

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.env = deps.env ?? process.env
    this.logger = deps.logger
    this.flumeDeps = deps.flumeDeps ?? {}
    this.diagnostics = new FunnelConnectorDiagnosticsRecorder({
      type: "slack",
      connectorId: deps.config.id,
      channelId: deps.channelId ?? null,
      log: deps.diagnosticLog,
    })
  }

  async start(notify: NotifyFn): Promise<void> {
    this.diagnostics.recordConnection("started", "")

    const appToken = resolveConnectorToken({
      literal: this.config.appToken,
      envVar: this.config.appTokenEnv,
      env: this.env,
      label: `${this.config.name}.appToken`,
    })

    this.botToken = resolveConnectorToken({
      literal: this.config.botToken,
      envVar: this.config.botTokenEnv,
      env: this.env,
      label: `${this.config.name}.botToken`,
    })

    // Self-detection: call auth.test with the bot token to learn the bot's own
    // user/bot id, which the processor uses to drop self-authored events. A
    // bad/expired token surfaces here before the socket opens — the most
    // common "no events ever arrive" cause.
    const auth = await this.callAuthTest()

    if (!auth.ok) {
      this.diagnostics.recordConnection("auth-failed", auth.error ?? "auth.test returned ok=false")
      throw new Error(`slack auth.test failed: ${auth.error ?? "unknown"}`)
    }

    this.processor = new FunnelSlackEventProcessor({
      ownBotUserId: auth.user_id ?? "",
      ownBotId: auth.bot_id ?? "",
      minify: this.config.minify,
    })

    const source = new FlumeSlackSource({
      appToken,
      botToken: this.botToken,
      reconnect: true,
      onLog: flumeLogHandler(this.logger),
      onStatus: (status, detail) => this.handleStatus(status, detail),
      deps: { ...flumeRuntimeDeps(), ...this.flumeDeps },
    })

    this.source = source

    try {
      await source.start((event) => this.handleEvent(event, notify))
    } catch (error) {
      this.diagnostics.recordConnection("error", errorMessageOf(error))
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.source) return

    try {
      await this.source.stop()
      this.diagnostics.recordConnection("disconnected", "")
    } catch (error) {
      this.diagnostics.recordConnection("error", errorMessageOf(error))
      this.logger?.error("slack stop error", { error: errorMessageOf(error) })
    } finally {
      this.source = null
      this.processor = null
      this.connected = false
      this.diagnostics.recordConnection("stopped", "")
    }
  }

  override isAlive(): boolean {
    return this.source !== null && this.connected
  }

  private async callAuthTest() {
    let res: Response

    try {
      res = await fetch(AUTH_TEST_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      })
    } catch (error) {
      this.diagnostics.recordConnection("auth-failed", errorMessageOf(error))
      throw error
    }

    const text = await res.text()
    const parsed = authTestResponseSchema.safeParse(safeJsonParse(text))

    if (!parsed.success) {
      return {
        ok: false,
        error: `non-JSON auth.test response: ${text.slice(0, 200)}`,
      }
    }

    return parsed.data
  }

  private handleStatus(status: FlumeStatus, detail?: string): void {
    if (status === "connected") {
      this.connected = true
      this.diagnostics.recordConnection("connected", detail ?? "")
      return
    }

    if (status === "disconnected") {
      this.connected = false
      this.diagnostics.recordConnection("disconnected", detail ?? "")
      return
    }

    if (status === "reconnecting") {
      this.connected = false
    }
  }

  private handleEvent(event: FlumeEvent, notify: NotifyFn): void {
    if (!this.processor) return

    // Flume's Slack source emits events_api envelopes with payload.event as the
    // actual Slack event. The processor expects the raw event record (the
    // contents of `payload.event`), not the whole envelope.
    const envelope = FlumeSlackEnvelopeSchema.safeParse(event.data)
    if (!envelope.success) return

    const rawEvent = envelope.data.payload.event
    if (!isSlackRawEvent(rawEvent)) return

    const eventId = crypto.randomUUID()
    const rawJson = JSON.stringify(rawEvent)
    this.diagnostics.recordRaw(eventId, rawJson)

    const result = this.processor.process(rawEvent)

    if (result.skip) {
      this.diagnostics.recordProcessed(eventId, result.reason, rawJson)
      return
    }

    void this.deliver(notify, eventId, rawJson, result.content, result.meta, result.shouldReact)
  }

  private async deliver(
    notify: NotifyFn,
    eventId: string,
    rawJson: string,
    content: string,
    meta: Record<string, string>,
    shouldReact: boolean,
  ): Promise<void> {
    try {
      await notify(content, meta)
    } catch (error) {
      this.diagnostics.recordProcessed(eventId, "emitted:delivery-failed", content || rawJson)
      throw error
    }

    this.diagnostics.recordProcessed(eventId, "emitted", content)

    if (shouldReact) {
      await this.postReaction(meta).catch(() => {
        // Reaction failures are non-fatal; the event was already delivered.
      })
    }
  }

  private async postReaction(meta: Record<string, string>): Promise<void> {
    await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        channel: meta.channel_id ?? "",
        timestamp: meta.thread_ts ?? "",
        name: "eyes",
      }).toString(),
    })
  }
}

const isSlackRawEvent = (value: unknown): value is SlackRawEvent =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
