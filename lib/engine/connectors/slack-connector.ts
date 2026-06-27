import { FunnelSlackAdapter } from "@/engine/connectors/slack-adapter"
import { slackConnectorSchema } from "@/engine/connectors/slack-connector-schema"
import {
  FunnelFlumeSlackListener,
  type SlackPreprocessEvent,
} from "@/engine/connectors/slack-flume-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { slotFields } from "@/engine/connectors/slot-fields"

export type SlackConnectorOptions = {
  /**
   * Optional host-side preprocessor applied to every raw Slack event after
   * the envelope is unwrapped and BEFORE the funnel processor runs. Return
   * the (possibly transformed) event to keep processing, or `null` to drop
   * it (the listener records `skip:preprocess` so the drop is auditable).
   *
   * Useful for tenant-specific concerns funnel deliberately does not
   * enshrine: stripping attachments, neutralizing channel-tag injection,
   * fan-out to multiple processors, etc. Returning `null` here is the only
   * way to drop an event for a reason the processor's gates do not cover.
   */
  preprocessEvent?: SlackPreprocessEvent
}

/**
 * Slack connector descriptor. Pass `slackConnector()` to
 * `new Funnel({ connectors: [...] })` to enable the type.
 *
 * The listener is backed by `@interactive-inc/flume`'s `FlumeSlackSource`
 * (raw Socket Mode WebSocket). Only the events API envelope is delivered —
 * there is no equivalent for the Bolt-style `app.action` / `app.command`
 * dispatch. For HTTP-side interactivity (buttons, slash commands), run a
 * separate Bolt app outside funnel; this descriptor only handles the
 * incoming events firehose.
 */
export const slackConnector = (options: SlackConnectorOptions = {}): ConnectorDescriptor => ({
  type: "slack",
  toolExposed: true,
  createListener(config, deps) {
    const parsed = slackConnectorSchema.parse(config)

    return new FunnelFlumeSlackListener({
      config: parsed,
      channelId: deps.channelId,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
      http: deps.http,
      signal: deps.signal,
      preprocessEvent: options.preprocessEvent,
    })
  },
  createAdapter(config, deps) {
    return new FunnelSlackAdapter({
      config: slackConnectorSchema.parse(config),
      http: deps.http,
    })
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
