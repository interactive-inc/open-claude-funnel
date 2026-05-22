import { App, LogLevel } from "@slack/bolt"
import { z } from "zod"
import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener"
import {
  FunnelSlackEventProcessor,
  type SlackRawEvent,
} from "@/connectors/slack-event-processor"
import { FunnelLogger } from "@/engine/logger/logger"
import type { SlackConnectorConfig } from "@/connectors/slack-connector-schema"

const middlewareArgsSchema = z.object({
  event: z.record(z.string(), z.unknown()).optional(),
})

export type SlackOnAppCreated = (app: App) => void | Promise<void>
export type SlackPreprocessEvent = (event: SlackRawEvent) => SlackRawEvent | null

type Deps = {
  config: SlackConnectorConfig
  logger?: FunnelLogger
  /**
   * Invoked after the Bolt App is constructed, before it starts.
   * Use to attach app.action handlers, custom middleware, etc.
   */
  onAppCreated?: SlackOnAppCreated
  /**
   * Transform or drop the raw Slack event before the built-in processor sees it.
   * Return null to drop the event entirely.
   */
  preprocessEvent?: SlackPreprocessEvent
}


export class FunnelSlackListener extends FunnelConnectorListener {
  private readonly config: SlackConnectorConfig
  private readonly logger: FunnelLogger | undefined
  private readonly onAppCreated: SlackOnAppCreated | null
  private readonly preprocessEvent: SlackPreprocessEvent | null
  private app: App | null = null

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.logger = deps.logger
    this.onAppCreated = deps.onAppCreated ?? null
    this.preprocessEvent = deps.preprocessEvent ?? null
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
      minify: this.config.minify,
    })

    const preprocess = this.preprocessEvent

    app.use(async (args) => {
      const parsed = middlewareArgsSchema.safeParse(args)

      // Only events are funnel's concern. Payloads without an `event` key
      // (block_actions, view_submission, slash commands, …) must fall through
      // to the listeners registered via onAppCreated — call next() instead of
      // swallowing them, or app.action handlers (e.g. approval buttons) never
      // fire. This middleware consumes events and lets everything else pass.
      if (!parsed.success || !parsed.data.event) {
        await args.next()
        return
      }

      const rawEvent = parsed.data.event as SlackRawEvent
      const event = preprocess ? preprocess(rawEvent) : rawEvent

      if (event === null) return

      const result = processor.process(event)

      if (result.skip) return

      // notify first: if delivery to the funnel throws, we deliberately skip
      // the eyes reaction so an undelivered message is not marked as seen.
      await notify(result.content, result.meta)

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
    })

    app.error(async (error) => {
      this.logger?.error("Slack error", {
        error: error instanceof Error ? error.message : String(error),
      })
    })

    if (this.onAppCreated) await this.onAppCreated(app)

    await app.start()
    this.app = app
  }

  async stop(): Promise<void> {
    if (!this.app) return

    try {
      await this.app.stop()
    } catch (error) {
      this.logger?.error("Slack stop error", {
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
