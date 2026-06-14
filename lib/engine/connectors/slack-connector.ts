import { FunnelSlackAdapter } from "@/engine/connectors/slack-adapter"
import { slackConnectorSchema } from "@/engine/connectors/slack-connector-schema"
import type {
  SlackOnAppCreated,
  SlackPreprocessEvent,
} from "@/engine/connectors/slack-listener"
import { FunnelSlackListener } from "@/engine/connectors/slack-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { slotFields } from "@/engine/connectors/slot-fields"

export type SlackConnectorOptions = {
  /** Invoked after the Bolt App is constructed, before start — attach app.action handlers etc. */
  onAppCreated?: SlackOnAppCreated
  /** Transform or drop a raw Slack event before the built-in processor sees it. */
  preprocessEvent?: SlackPreprocessEvent
}

/**
 * Slack connector descriptor. Pass `slackConnector()` to
 * `new Funnel({ connectors: [...] })` to enable the type. Host launch hooks are
 * closed over here, so they need no Funnel-level option plumbing.
 */
export const slackConnector = (options: SlackConnectorOptions = {}): ConnectorDescriptor => ({
  type: "slack",
  toolExposed: true,
  createListener(config, deps) {
    const parsed = slackConnectorSchema.parse(config)

    return new FunnelSlackListener({
      config: parsed,
      channelId: deps.channelId,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
      onAppCreated: options.onAppCreated,
      preprocessEvent: options.preprocessEvent,
    })
  },
  createAdapter(config) {
    return new FunnelSlackAdapter({ config: slackConnectorSchema.parse(config) })
  },
  secretTokens(config) {
    const parsed = slackConnectorSchema.parse(config)

    return [parsed.botToken, parsed.appToken].filter((token) => token !== undefined)
  },
  buildConfig(input, context) {
    return slackConnectorSchema.parse({
      id: context.id,
      type: "slack",
      name: input.name,
      ...(typeof input.botToken === "string" ? { botToken: input.botToken } : {}),
      ...(typeof input.appToken === "string" ? { appToken: input.appToken } : {}),
      ...(typeof input.botTokenEnv === "string" ? { botTokenEnv: input.botTokenEnv } : {}),
      ...(typeof input.appTokenEnv === "string" ? { appTokenEnv: input.appTokenEnv } : {}),
      minify: typeof input.minify === "boolean" ? input.minify : true,
      createdAt: context.now,
      updatedAt: context.now,
    })
  },
  applyUpdate(config, fields, context) {
    const current = slackConnectorSchema.parse(config)

    // Each slot is rebuilt from scratch (not merged) so switching a slot from a
    // literal to an env reference drops the stale literal rather than keeping both.
    return slackConnectorSchema.parse({
      id: current.id,
      name: current.name,
      type: "slack",
      minify: current.minify,
      createdAt: current.createdAt,
      updatedAt: context.now,
      ...slotFields("botToken", "botTokenEnv", fields, current),
      ...slotFields("appToken", "appTokenEnv", fields, current),
    })
  },
  operations: {},
})
