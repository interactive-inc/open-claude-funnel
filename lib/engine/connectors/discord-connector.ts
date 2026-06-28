import { FunnelDiscordAdapter } from "@/engine/connectors/discord-adapter"
import { discordConnectorSchema } from "@/engine/connectors/discord-connector-schema"
import { FunnelFlumeDiscordListener } from "@/engine/connectors/discord-flume-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { slotFields } from "@/engine/connectors/slot-fields"

export type DiscordConnectorOptions = {
  /**
   * Discord gateway dispatch types funnel forwards to the broadcaster.
   * Pass an explicit allowlist (`["MESSAGE_CREATE", "MESSAGE_UPDATE"]`) for
   * fine-grained control, or `"all"` to skip the filter entirely and forward
   * every dispatch type the gateway emits. Defaults to MESSAGE_CREATE and
   * MESSAGE_UPDATE so the typical chat-style consumer is not flooded by
   * GUILD_CREATE / PRESENCE_UPDATE / VOICE_STATE_UPDATE snapshots on
   * connect. Reactions, interactivity, and guild-state dispatches require
   * opt-in via this list.
   *
   * Common values:
   *   ["MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_REACTION_ADD"]
   *   ["MESSAGE_CREATE", "INTERACTION_CREATE"]
   *   "all"   — debug / firehose
   */
  eventTypes?: ReadonlyArray<string> | "all"
}

/**
 * Discord connector descriptor. Pass `discordConnector()` to
 * `new Funnel({ connectors: [...] })` to enable the type.
 *
 * The listener is backed by `@interactive-inc/flume`'s `FlumeDiscordSource`
 * (raw Gateway WebSocket).
 */
export const discordConnector = (options: DiscordConnectorOptions = {}): ConnectorDescriptor => ({
  type: "discord",
  toolExposed: true,
  createListener(config, deps) {
    return new FunnelFlumeDiscordListener({
      config: discordConnectorSchema.parse(config),
      channelId: deps.channelId,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
      signal: deps.signal,
      eventTypes: options.eventTypes,
    })
  },
  createAdapter(config, deps) {
    return new FunnelDiscordAdapter({
      config: discordConnectorSchema.parse(config),
      http: deps.http,
    })
  },
  secretTokens(config) {
    const parsed = discordConnectorSchema.parse(config)

    return [parsed.botToken].filter((token) => token !== undefined)
  },
  buildConfig(input, context) {
    return discordConnectorSchema.parse({
      id: context.id,
      type: "discord",
      name: input.name,
      ...(typeof input.botToken === "string" ? { botToken: input.botToken } : {}),
      ...(typeof input.botTokenEnv === "string" ? { botTokenEnv: input.botTokenEnv } : {}),
      createdAt: context.now,
      updatedAt: context.now,
    })
  },
  applyUpdate(config, fields, context) {
    const current = discordConnectorSchema.parse(config)

    return discordConnectorSchema.parse({
      id: current.id,
      name: current.name,
      type: "discord",
      createdAt: current.createdAt,
      updatedAt: context.now,
      ...slotFields("botToken", "botTokenEnv", fields, current),
    })
  },
  operations: {},
})
