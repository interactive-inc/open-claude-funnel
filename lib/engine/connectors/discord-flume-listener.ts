import { FlumeDiscordSource, FlumeDiscordGatewayIntents } from "@interactive-inc/flume/discord"
import type { FlumeDiscordEvent, FlumeRuntimeDeps } from "@interactive-inc/flume"
import type { NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { FunnelDiscordEventProcessor } from "@/engine/connectors/discord-event-processor"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import { flumeLogHandler, resolveFlumeDeps } from "@/engine/connectors/flume-deps"
import { FunnelFlumeSourceListener } from "@/engine/connectors/flume-source-listener"
import type { FunnelLogger } from "@/engine/logger/logger"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { DiscordConnectorConfig } from "@/engine/connectors/discord-connector-schema"

type Deps = {
  config: DiscordConnectorConfig
  channelId?: string
  env?: NodeJS.ProcessEnv
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  flumeDeps?: Partial<FlumeRuntimeDeps>
  /** Shutdown signal forwarded to the underlying Flume. */
  signal?: AbortSignal
  /** See `DiscordConnectorOptions.eventTypes`. */
  eventTypes?: ReadonlyArray<string> | "all"
}

/**
 * Default allowlist of Discord gateway dispatch types funnel forwards. Set
 * to chat-style events so the typical consumer is not flooded by guild
 * snapshot dispatches (GUILD_CREATE / PRESENCE_UPDATE / VOICE_STATE_UPDATE
 * etc.). Override per-instance via `discordConnector({ eventTypes })`.
 */
const DEFAULT_EVENT_TYPES: ReadonlyArray<string> = ["MESSAGE_CREATE", "MESSAGE_UPDATE"]

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
export class FunnelFlumeDiscordListener extends FunnelFlumeSourceListener {
  private readonly config: DiscordConnectorConfig
  private readonly env: NodeJS.ProcessEnv
  private readonly flumeDeps: Partial<FlumeRuntimeDeps>
  private readonly signal: AbortSignal | undefined
  private readonly eventTypes: ReadonlySet<string> | "all"
  private processor: FunnelDiscordEventProcessor | null = null

  constructor(deps: Deps) {
    super({
      type: "discord",
      connectorId: deps.config.id,
      channelId: deps.channelId ?? null,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
    })
    this.config = deps.config
    this.env = deps.env ?? process.env
    this.flumeDeps = deps.flumeDeps ?? {}
    this.signal = deps.signal
    this.eventTypes = deps.eventTypes === "all" ? "all" : new Set(deps.eventTypes ?? DEFAULT_EVENT_TYPES)
  }

  async start(notify: NotifyFn): Promise<void> {
    this.diagnostics.recordConnection("started", "")

    let token: string

    try {
      token = resolveConnectorToken({
        literal: this.config.botToken,
        envVar: this.config.botTokenEnv,
        env: this.env,
        label: `${this.config.name}.botToken`,
      })
    } catch (error) {
      this.diagnostics.recordConnection("auth-failed", errorMessageOf(error))
      throw error
    }

    // Source ctor takes only protocol-specific options in Flume 0.9.
    // Funnel's processor reads message content and mentions, so the privileged
    // `MessageContent` intent must be requested explicitly — Flume's default
    // omits it. Guilds + GuildMessages cover server channels; DirectMessages
    // covers DM threads with the bot.
    const source = new FlumeDiscordSource({
      token,
      intents:
        FlumeDiscordGatewayIntents.Guilds |
        FlumeDiscordGatewayIntents.GuildMessages |
        FlumeDiscordGatewayIntents.MessageContent |
        FlumeDiscordGatewayIntents.DirectMessages,
    })

    await this.runStart({
      source,
      onLog: flumeLogHandler(this.logger),
      deps: resolveFlumeDeps(this.flumeDeps),
      signal: this.signal,
      onEvent: (event) => {
        if (event.source !== "discord") return Promise.resolve()
        return this.handleEvent(event, notify)
      },
    })
  }

  protected override onStop(): void {
    this.processor = null
  }

  private async handleEvent(event: FlumeDiscordEvent, notify: NotifyFn): Promise<void> {
    // Capture the bot's own user id from READY and build the processor once.
    // Flume passes the READY dispatch through like any other event; we
    // intercept it here so the processor can self-filter, then return without
    // delivering it.
    if (event.type === "READY") {
      this.adoptReady(event.data)
      return
    }

    if (!this.processor) {
      // Record once per pre-READY event so an unexpected pre-handshake delivery
      // is not silently lost; the eventId is unique so this can never collide
      // with a later READY-bound row.
      const skipId = crypto.randomUUID()
      this.diagnostics.recordRaw(skipId, JSON.stringify(event.data))
      this.diagnostics.recordProcessed(skipId, "skip:pre-ready", "")
      return
    }

    // Discord's gateway sends 70+ dispatch types (GUILD_CREATE / GUILD_UPDATE /
    // PRESENCE_UPDATE / GUILD_MEMBER_UPDATE / VOICE_STATE_UPDATE / TYPING_START /
    // CHANNEL_UPDATE / …). Their payloads carry the entire guild snapshot
    // (members, roles, channels, voice states) — tens of KB each. By default
    // the listener narrows to chat-shaped dispatches; the host can override
    // via `discordConnector({ eventTypes: [...] | "all" })`. Dropped events
    // still get a diagnostic row so 'did the event arrive' stays answerable.
    if (this.eventTypes !== "all" && !this.eventTypes.has(event.type)) {
      const skipId = crypto.randomUUID()
      this.diagnostics.recordRaw(skipId, JSON.stringify(event.data))
      this.diagnostics.recordProcessed(skipId, `skip:filtered:${event.type}`, "")
      return
    }

    const data = event.data
    // channel_id / guild_id / user_id come from flume's extractor (event.meta);
    // authorIsBot and mentions[].id are not surfaced there so we still read them
    // from the raw dispatch.
    const author = isRecord(data.author) ? data.author : null
    const authorIsBot = author !== null && author.bot === true
    const authorId = event.meta.user_id ?? ""
    const channelId = event.meta.channel_id ?? ""
    const guildId = event.meta.guild_id ?? null
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

    await this.deliver(notify, eventId, rawJson, result.content, result.meta)
  }

  private adoptReady(data: Record<string, unknown>): void {
    const fromUser = isRecord(data.user) ? readString(data.user, "id") : undefined
    const fromTop = readString(data, "user_id")
    const ownUserId = fromUser ?? fromTop ?? ""

    if (!ownUserId) {
      // A READY without a usable user id leaves self-skip disabled forever,
      // and every subsequent event would have to be silently dropped. Surface
      // it loudly so an operator sees the listener is wedged.
      const skipId = crypto.randomUUID()
      this.diagnostics.recordRaw(skipId, JSON.stringify(data))
      this.diagnostics.recordProcessed(skipId, "skip:ready-missing-user-id", "")
      this.diagnostics.recordConnection(
        "error",
        "discord READY payload had neither user.id nor user_id; processor not initialized",
      )
      this.logger?.error("discord READY missing user id", {
        connector: this.config.name,
      })
      return
    }

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
