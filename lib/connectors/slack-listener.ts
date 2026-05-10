import { App, LogLevel } from "@slack/bolt"
import { z } from "zod"
import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener"
import { FunnelSlackEventProcessor } from "@/connectors/slack-event-processor"
import { FunnelLogger } from "@/engine/logger/logger"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import type { SlackConnectorConfig } from "@/connectors/slack-connector-schema"

const middlewareArgsSchema = z.object({
  event: z.record(z.string(), z.unknown()).optional(),
})

type Deps = {
  config: SlackConnectorConfig
  logger?: FunnelLogger
}

const defaultLogger = new NodeFunnelLogger()

export class FunnelSlackListener extends FunnelConnectorListener {
  private readonly config: SlackConnectorConfig
  private readonly logger: FunnelLogger
  private app: App | null = null

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.logger = deps.logger ?? defaultLogger
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
      const parsed = middlewareArgsSchema.safeParse(args)

      if (!parsed.success || !parsed.data.event) return

      const result = processor.process(parsed.data.event)

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
      this.logger.error("Slack error", {
        error: error instanceof Error ? error.message : String(error),
      })
    })

    await app.start()
    this.app = app
  }

  async stop(): Promise<void> {
    if (!this.app) return

    try {
      await this.app.stop()
    } catch (error) {
      this.logger.error("Slack stop error", {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.app = null
    }
  }

  override isAlive(): boolean {
    return this.app !== null
  }
}
