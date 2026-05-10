import type { Client } from "discord.js"
import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener"
import { FunnelDiscordEventProcessor } from "@/connectors/discord-event-processor"
import { FunnelLogger } from "@/engine/logger/logger"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import type { DiscordConnectorConfig } from "@/connectors/discord-connector-schema"

type Deps = {
  config: DiscordConnectorConfig
  logger?: FunnelLogger
}

const defaultLogger = new NodeFunnelLogger()

export class FunnelDiscordListener extends FunnelConnectorListener {
  private readonly config: DiscordConnectorConfig
  private readonly logger: FunnelLogger
  private client: Client | null = null

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.logger = deps.logger ?? defaultLogger
  }

  async start(notify: NotifyFn): Promise<void> {
    const discord = await import("discord.js")
    const client = new discord.Client({
      intents: [
        discord.GatewayIntentBits.Guilds,
        discord.GatewayIntentBits.GuildMessages,
        discord.GatewayIntentBits.MessageContent,
        discord.GatewayIntentBits.DirectMessages,
      ],
      partials: [discord.Partials.Channel],
    })

    client.on("messageCreate", async (message) => {
      const processor = new FunnelDiscordEventProcessor({ ownUserId: client.user?.id ?? "" })

      const result = processor.process({
        authorId: message.author.id,
        authorIsBot: message.author.bot,
        channelId: message.channelId,
        guildId: message.guildId,
        mentionedUserIds: [...message.mentions.users.keys()],
        raw: message.toJSON(),
      })

      if (result.skip) return

      try {
        await notify(result.content, result.meta)
      } catch (error) {
        this.logger.error("discord notify error", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    client.on("error", (error) => {
      this.logger.error("discord client error", {
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
      this.logger.error("discord stop error", {
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
