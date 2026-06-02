import { Client, GatewayIntentBits, Partials } from "discord.js"
import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener"
import { FunnelDiscordEventProcessor } from "@/connectors/discord-event-processor"
import { resolveConnectorToken } from "@/connectors/resolve-connector-token"
import { FunnelLogger } from "@/engine/logger/logger"
import type {
  ConnectorConnectionStatus,
  ConnectorDiagnosticLog,
} from "@/gateway/connector-diagnostic-log"
import type { DiscordConnectorConfig } from "@/connectors/discord-connector-schema"

type Deps = {
  config: DiscordConnectorConfig
  /** Funnel channel uuid this connector lives under; stamped onto diagnostic-log rows. */
  channelId?: string
  /** Environment used to resolve a `botTokenEnv` reference. Defaults to process.env. */
  env?: NodeJS.ProcessEnv
  logger?: FunnelLogger
  /** Diagnostic log of inbound events, before and after processing. No-op when absent. */
  diagnosticLog?: ConnectorDiagnosticLog
}

export class FunnelDiscordListener extends FunnelConnectorListener {
  private readonly config: DiscordConnectorConfig
  private readonly channelId: string | null
  private readonly env: NodeJS.ProcessEnv
  private readonly logger: FunnelLogger | undefined
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private client: Client | null = null

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.channelId = deps.channelId ?? null
    this.env = deps.env ?? process.env
    this.logger = deps.logger
    this.diagnosticLog = deps.diagnosticLog
  }

  async start(notify: NotifyFn): Promise<void> {
    this.recordConnection("started", "")

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    })

    client.on("messageCreate", async (message) => {
      const ownUserId = client.user?.id ?? ""
      const mentionedUserIds = [...message.mentions.users.keys()]

      this.logger?.info("discord messageCreate", {
        author: message.author.id,
        authorIsBot: String(message.author.bot),
        channelId: message.channelId,
        guildId: message.guildId ?? "",
        mentions: mentionedUserIds.join(","),
        ownUserId,
        mentioned: String(mentionedUserIds.includes(ownUserId)),
      })

      const rawEvent = message.toJSON()

      // One id per inbound event, shared by its raw and processed rows so the
      // two are joinable across the separate diagnostic tables.
      const eventId = crypto.randomUUID()

      // Record the untouched event before any filtering — this is the ground
      // truth for "did Discord actually deliver it?". Everything dropped
      // downstream still has a raw row.
      this.recordRaw(eventId, rawEvent)

      const processor = new FunnelDiscordEventProcessor({ ownUserId })

      const result = processor.process({
        authorId: message.author.id,
        authorIsBot: message.author.bot,
        channelId: message.channelId,
        guildId: message.guildId,
        mentionedUserIds,
        raw: rawEvent,
      })

      if (result.skip) {
        // The processor only drops bot-authored messages, so the reason is
        // fixed — its skip verdict carries no reason field.
        this.recordProcessed(eventId, rawEvent, "skip:bot", "")
        this.logger?.info("discord skip", { reason: "bot author" })
        return
      }

      // Record the verdict only after delivery resolves, and reflect a failed
      // delivery as its own outcome. notify failures are swallowed (not
      // rethrown) here, but the diagnostic row is still kept.
      try {
        await notify(result.content, result.meta)
      } catch (error) {
        this.recordProcessed(eventId, rawEvent, "emitted:delivery-failed", result.content)
        this.logger?.error("discord notify error", { error: messageOf(error) })
        return
      }

      this.recordProcessed(eventId, rawEvent, "emitted", result.content)
    })

    client.on("ready", (readyClient) => {
      this.logger?.info("discord ready", {
        userId: readyClient.user.id,
        tag: readyClient.user.tag,
        guilds: String(readyClient.guilds.cache.size),
      })
    })

    client.on("error", (error) => {
      this.recordConnection("error", messageOf(error))
      this.logger?.error("discord client error", { error: messageOf(error) })
    })

    try {
      await client.login(
        resolveConnectorToken({
          literal: this.config.botToken,
          envVar: this.config.botTokenEnv,
          env: this.env,
          label: `${this.config.name}.botToken`,
        }),
      )
    } catch (error) {
      // login both validates the token and opens the gateway, so a bad token
      // surfaces here. Discord has no separate auth check (unlike Slack's
      // auth.test), so all login failures land as a single "error".
      this.recordConnection("error", messageOf(error))
      throw error
    }

    this.client = client
    this.recordConnection("connected", "")
  }

  async stop(): Promise<void> {
    if (!this.client) return

    try {
      await this.client.destroy()
      this.recordConnection("disconnected", "")
    } catch (error) {
      this.recordConnection("error", messageOf(error))
      this.logger?.error("discord stop error", { error: messageOf(error) })
    } finally {
      this.client = null
      this.recordConnection("stopped", "")
    }
  }

  override isAlive(): boolean {
    return this.client !== null
  }

  private recordRaw(eventId: string, rawEvent: unknown): void {
    this.diagnosticLog?.recordRaw({
      eventId,
      type: "discord",
      connectorId: this.config.id,
      channelId: this.channelId,
      payload: JSON.stringify(rawEvent),
    })
  }

  private recordProcessed(
    eventId: string,
    rawEvent: unknown,
    outcome: string,
    content: string,
  ): void {
    this.diagnosticLog?.recordProcessed({
      eventId,
      type: "discord",
      connectorId: this.config.id,
      channelId: this.channelId,
      outcome,
      payload: content || JSON.stringify(rawEvent),
    })
  }

  private recordConnection(status: ConnectorConnectionStatus, detail: string): void {
    this.diagnosticLog?.recordConnection({
      type: "discord",
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
