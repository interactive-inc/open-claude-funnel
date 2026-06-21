import { FunnelSlackAdapter } from "@/engine/connectors/slack-adapter"
import { slackConnectorSchema } from "@/engine/connectors/slack-connector-schema"
import { FunnelFlumeSlackListener } from "@/engine/connectors/slack-flume-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { slotFields } from "@/engine/connectors/slot-fields"

/**
 * Slack connector descriptor. Pass `slackConnector()` to
 * `new Funnel({ connectors: [...] })` to enable the type.
 *
 * The listener is backed by `@interactive-inc/flume`'s `FlumeSlackSource`
 * (raw Socket Mode WebSocket). Only the events API envelope is delivered —
 * there is no equivalent for the Bolt-style `app.action` / `app.command`
 * dispatch or middleware preprocessing.
 */
export const slackConnector = (): ConnectorDescriptor => ({
  type: "slack",
  toolExposed: true,
  createListener(config, deps) {
    const parsed = slackConnectorSchema.parse(config)

    return new FunnelFlumeSlackListener({
      config: parsed,
      channelId: deps.channelId,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
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
