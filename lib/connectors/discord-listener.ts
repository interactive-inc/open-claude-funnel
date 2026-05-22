import { Client, GatewayIntentBits, Partials } from "discord.js"
import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener"
import { FunnelDiscordEventProcessor } from "@/connectors/discord-event-processor"
import { FunnelLogger } from "@/engine/logger/logger"
import type { DiscordConnectorConfig } from "@/connectors/discord-connector-schema"

type Deps = {
  config: DiscordConnectorConfig
  logger?: FunnelLogger
}


export class FunnelDiscordListener extends FunnelConnectorListener {
  private readonly config: DiscordConnectorConfig
  private readonly logger: FunnelLogger | undefined
  private client: Client | null = null

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.logger = deps.logger
  }

  async start(notify: NotifyFn): Promise<void> {
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

      const processor = new FunnelDiscordEventProcessor({ ownUserId })

      const result = processor.process({
        authorId: message.author.id,
        authorIsBot: message.author.bot,
        channelId: message.channelId,
        guildId: message.guildId,
        mentionedUserIds,
        raw: message.toJSON(),
      })

      if (result.skip) {
        this.logger?.info("discord skip", { reason: "bot author" })
        return
      }

      try {
        await notify(result.content, result.meta)
      } catch (error) {
        this.logger?.error("discord notify error", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    client.on("ready", (readyClient) => {
      this.logger?.info("discord ready", {
        userId: readyClient.user.id,
        tag: readyClient.user.tag,
        guilds: String(readyClient.guilds.cache.size),
      })
    })

    client.on("error", (error) => {
      this.logger?.error("discord client error", {
        error: error instanceof Error ? error.message : String(error),
      })
    })

    await client.login(this.config.botToken)
    this.client = client
  }

  async stop(): Promise<void> {
    if (!this.client) return

    try {
      await this.client.destroy()
    } catch (error) {
      this.logger?.error("discord stop error", {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.client = null
    }
  }

  override isAlive(): boolean {
    return this.client !== null
  }
}
