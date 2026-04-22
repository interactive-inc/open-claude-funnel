import { App, LogLevel } from "@slack/bolt"
import {
  FunnelConnectorListener,
  type NotifyFn,
} from "@/modules/connectors/funnel-connector-listener"
import { FunnelSlackEventProcessor } from "@/modules/connectors/funnel-slack-event-processor"
import { logger } from "@/modules/logger"
import type { SlackConnectorConfig } from "@/modules/connectors/slack-connector-schema"

type Deps = {
  config: SlackConnectorConfig
}

export class FunnelSlackListener extends FunnelConnectorListener {
  private readonly config: SlackConnectorConfig

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    Object.freeze(this)
  }

  async start(notify: NotifyFn): Promise<void> {
    const app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
      logLevel: LogLevel.ERROR,
    })

    const authResult = await app.client.auth.test({ token: this.config.botToken })
    const processor = new FunnelSlackEventProcessor({
      ownBotUserId: authResult.user_id ?? "",
      ownBotId: authResult.bot_id ?? "",
    })

    app.use(async (args) => {
      const event = (args as unknown as Record<string, unknown>).event as
        | Record<string, unknown>
        | undefined

      if (!event) return

      const result = processor.process(event)

      if (result.skip) return

      if (result.shouldReact) {
        try {
          await app.client.reactions.add({
            token: this.config.botToken,
            channel: result.channel,
            timestamp: result.timestamp,
            name: "eyes",
          })
        } catch {
          // ignore
        }
      }

      await notify(result.content, result.meta)
    })

    app.error(async (error) => {
      logger.error("Slack error", {
        error: error instanceof Error ? error.message : String(error),
      })
    })

    await app.start()
  }
}
