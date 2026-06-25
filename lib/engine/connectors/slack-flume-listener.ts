import { FlumeSlackSource } from "@interactive-inc/flume/slack"
import type { FlumeSlackEvent, FlumeRuntimeDeps } from "@interactive-inc/flume"
import { z } from "zod"
import type { NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import {
  FunnelSlackEventProcessor,
  type SlackRawEvent,
} from "@/engine/connectors/slack-event-processor"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import { flumeLogHandler, resolveFlumeDeps } from "@/engine/connectors/flume-deps"
import { FunnelFlumeSourceListener } from "@/engine/connectors/flume-source-listener"
import type { FunnelLogger } from "@/engine/logger/logger"
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
export class FunnelFlumeSlackListener extends FunnelFlumeSourceListener {
  private readonly config: SlackConnectorConfig
  private readonly env: NodeJS.ProcessEnv
  private readonly flumeDeps: Partial<FlumeRuntimeDeps>
  private processor: FunnelSlackEventProcessor | null = null
  private botToken = ""

  constructor(deps: Deps) {
    super({
      type: "slack",
      connectorId: deps.config.id,
      channelId: deps.channelId ?? null,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
    })
    this.config = deps.config
    this.env = deps.env ?? process.env
    this.flumeDeps = deps.flumeDeps ?? {}
  }

  async start(notify: NotifyFn): Promise<void> {
    this.diagnostics.recordConnection("started", "")

    let appToken: string
    let botToken: string

    try {
      appToken = resolveConnectorToken({
        literal: this.config.appToken,
        envVar: this.config.appTokenEnv,
        env: this.env,
        label: `${this.config.name}.appToken`,
      })

      botToken = resolveConnectorToken({
        literal: this.config.botToken,
        envVar: this.config.botTokenEnv,
        env: this.env,
        label: `${this.config.name}.botToken`,
      })
    } catch (error) {
      this.diagnostics.recordConnection("auth-failed", errorMessageOf(error))
      throw error
    }

    this.botToken = botToken

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
      deps: resolveFlumeDeps(this.flumeDeps),
    })

    await this.runStart(source, (event) => {
      if (event.source !== "slack") return
      this.handleEvent(event, notify)
    })
  }

  protected override onStop(): void {
    this.processor = null
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

  private handleEvent(event: FlumeSlackEvent, notify: NotifyFn): void {
    if (!this.processor) return

    // Flume's Slack source delivers the envelope's `payload` as `event.data`.
    // The events_api envelope nests the actual event under `payload.event`, so
    // we unwrap once more to reach the raw Slack event the processor expects.
    const rawEvent = event.data.event

    if (!isSlackRawEvent(rawEvent)) {
      // Record the envelope so an unexpected payload shape leaves a trail —
      // otherwise a Slack-side envelope change produces zero diagnostic signal.
      const skipId = crypto.randomUUID()
      this.diagnostics.recordRaw(skipId, JSON.stringify(event.data))
      this.diagnostics.recordProcessed(skipId, "skip:non-object-event", "")
      return
    }

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
      this.logger?.error("slack notify error", { error: errorMessageOf(error) })
      return
    }

    this.diagnostics.recordProcessed(eventId, "emitted", content)

    if (shouldReact) {
      await this.postReaction(meta).catch((error) => {
        // Reactions are non-fatal but record both transport and logical
        // failures so the operator can spot a wedged token / wrong scope.
        this.diagnostics.recordProcessed(
          eventId,
          "emitted:reaction-failed",
          errorMessageOf(error),
        )
        this.logger?.warn("slack reaction failed", { error: errorMessageOf(error) })
      })
    }
  }

  private async postReaction(meta: Record<string, string>): Promise<void> {
    const res = await fetch("https://slack.com/api/reactions.add", {
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

    // Slack returns 200 with { ok: false, error: "..." } for logical errors
    // (already_reacted, channel_not_found, invalid_auth, ...). Promote those
    // to thrown errors so the diagnostic outcome above sees them.
    const text = await res.text()
    const parsed = parseSlackResponse(text)
    if (!parsed.ok) {
      throw new Error(`slack reactions.add: ${parsed.error ?? `status=${res.status}`}`)
    }
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

const slackResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
})

const parseSlackResponse = (text: string): { ok: boolean; error?: string } => {
  const parsed = slackResponseSchema.safeParse(safeJsonParse(text))

  if (!parsed.success) return { ok: false, error: `non-JSON response: ${text.slice(0, 200)}` }

  return parsed.data
}
