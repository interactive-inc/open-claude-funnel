import { FlumeDiscordSource } from "@interactive-inc/flume/discord"
import type { FlumeDiscordEvent, FlumeRuntimeDeps, FlumeStatus } from "@interactive-inc/flume"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { FunnelDiscordEventProcessor } from "@/engine/connectors/discord-event-processor"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import { flumeLogHandler, flumeRuntimeDeps } from "@/engine/connectors/flume-deps"
import { FunnelConnectorDiagnosticsRecorder } from "@/engine/connectors/connector-diagnostics-recorder"
import { FunnelLogger } from "@/engine/logger/logger"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { DiscordConnectorConfig } from "@/engine/connectors/discord-connector-schema"

type Deps = {
  config: DiscordConnectorConfig
  channelId?: string
  env?: NodeJS.ProcessEnv
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  flumeDeps?: Partial<FlumeRuntimeDeps>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]

  return typeof value === "string" ? value : undefined
}

/**
 * Discord listener backed by `@interactive-inc/flume`'s `FlumeDiscordSource`
 * (raw Gateway WebSocket + Zod). The processor layer
 * (`FunnelDiscordEventProcessor`) is the application layer — self-skip,
 * mention detection, meta shaping. Self-detection requires the bot's own
 * user id, which Discord does not surface until READY; we read it from the
 * READY payload on the first dispatch and build the processor then. Events
 * seen before READY are impossible by protocol, so no event is lost.
 */
export class FunnelFlumeDiscordListener extends FunnelConnectorListener {
  private readonly config: DiscordConnectorConfig
  private readonly env: NodeJS.ProcessEnv
  private readonly logger: FunnelLogger | undefined
  private readonly flumeDeps: Partial<FlumeRuntimeDeps>
  private readonly diagnostics: FunnelConnectorDiagnosticsRecorder
  private source: FlumeDiscordSource | null = null
  private processor: FunnelDiscordEventProcessor | null = null
  private connected = false

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.env = deps.env ?? process.env
    this.logger = deps.logger
    this.flumeDeps = deps.flumeDeps ?? {}
    this.diagnostics = new FunnelConnectorDiagnosticsRecorder({
      type: "discord",
      connectorId: deps.config.id,
      channelId: deps.channelId ?? null,
      log: deps.diagnosticLog,
    })
  }

  async start(notify: NotifyFn): Promise<void> {
    this.diagnostics.recordConnection("started", "")

    const token = resolveConnectorToken({
      literal: this.config.botToken,
      envVar: this.config.botTokenEnv,
      env: this.env,
      label: `${this.config.name}.botToken`,
    })

    const source = new FlumeDiscordSource({
      token,
      reconnect: true,
      onLog: flumeLogHandler(this.logger),
      onStatus: (status, detail) => this.handleStatus(status, detail),
      deps: { ...flumeRuntimeDeps(), ...this.flumeDeps },
    })

    this.source = source

    const startError = await source.start((event) => {
      if (event.source !== "discord") return
      this.handleEvent(event, notify)
    })

    if (startError instanceof Error) {
      this.diagnostics.recordConnection("error", errorMessageOf(startError))
      throw startError
    }
  }

  async stop(): Promise<void> {
    if (!this.source) return

    try {
      await this.source.stop()
      this.diagnostics.recordConnection("disconnected", "")
    } catch (error) {
      this.diagnostics.recordConnection("error", errorMessageOf(error))
      this.logger?.error("discord stop error", { error: errorMessageOf(error) })
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

  private handleEvent(event: FlumeDiscordEvent, notify: NotifyFn): void {
    // Capture the bot's own user id from READY and build the processor once.
    // Flume passes the READY dispatch through like any other event; we
    // intercept it here so the processor can self-filter, then return without
    // delivering it.
    if (event.type === "READY") {
      this.adoptReady(event.data)
      return
    }

    if (!this.processor) return

    const data = event.data
    const author = isRecord(data.author) ? data.author : null
    const authorIsBot = author !== null && author.bot === true
    const authorId = author !== null ? readString(author, "id") ?? "" : ""
    const channelId = readString(data, "channel_id") ?? ""
    const guildId = readString(data, "guild_id") ?? null
    const mentions = Array.isArray(data.mentions)
      ? data.mentions
          .map((m) => (isRecord(m) ? readString(m, "id") ?? "" : ""))
          .filter((id) => id !== "")
      : []

    const eventId = crypto.randomUUID()
    const rawJson = JSON.stringify(data)
    this.diagnostics.recordRaw(eventId, rawJson)

    const result = this.processor.process({
      authorId,
      authorIsBot,
      channelId,
      guildId,
      mentionedUserIds: mentions,
      raw: data,
    })

    if (result.skip) {
      this.diagnostics.recordProcessed(eventId, "skip:bot", rawJson)
      this.logger?.info("discord skip", { reason: "bot author" })
      return
    }

    void this.deliver(notify, eventId, rawJson, result.content, result.meta)
  }

  private adoptReady(data: Record<string, unknown>): void {
    const fromUser = isRecord(data.user) ? readString(data.user, "id") : undefined
    const fromTop = readString(data, "user_id")
    const ownUserId = fromUser ?? fromTop ?? ""

    if (!ownUserId) return

    this.processor = new FunnelDiscordEventProcessor({ ownUserId })
  }

  private async deliver(
    notify: NotifyFn,
    eventId: string,
    rawJson: string,
    content: string,
    meta: Record<string, string>,
  ): Promise<void> {
    try {
      await notify(content, meta)
    } catch (error) {
      this.diagnostics.recordProcessed(eventId, "emitted:delivery-failed", content || rawJson)
      this.logger?.error("discord notify error", { error: errorMessageOf(error) })
      return
    }

    this.diagnostics.recordProcessed(eventId, "emitted", content)
  }
}
