import { Client, GatewayIntentBits, Partials } from "discord.js"
import {
  FunnelConnectorListener,
  type NotifyFn,
} from "@/modules/connectors/funnel-connector-listener"
import { FunnelDiscordEventProcessor } from "@/modules/connectors/funnel-discord-event-processor"
import { FunnelLogger } from "@/modules/logger/funnel-logger"
import { NodeFunnelLogger } from "@/modules/logger/node-funnel-logger"
import type { DiscordConnectorConfig } from "@/modules/connectors/discord-connector-schema"

type Deps = {
  config: DiscordConnectorConfig
  logger?: FunnelLogger
}

const defaultLogger = new NodeFunnelLogger()

export class FunnelDiscordListener extends FunnelConnectorListener {
  private readonly config: DiscordConnectorConfig
  private readonly logger: FunnelLogger

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.logger = deps.logger ?? defaultLogger
    Object.freeze(this)
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
  }
}
