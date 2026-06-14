import { FunnelDiscordAdapter } from "@/engine/connectors/discord-adapter"
import { discordConnectorSchema } from "@/engine/connectors/discord-connector-schema"
import { FunnelDiscordListener } from "@/engine/connectors/discord-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { slotFields } from "@/engine/connectors/slot-fields"

/**
 * Discord connector descriptor. Pass `discordConnector()` to
 * `new Funnel({ connectors: [...] })` to enable the type.
 */
export const discordConnector = (): ConnectorDescriptor => ({
  type: "discord",
  toolExposed: true,
  createListener(config, deps) {
    return new FunnelDiscordListener({
      config: discordConnectorSchema.parse(config),
      channelId: deps.channelId,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
    })
  },
  createAdapter(config) {
    return new FunnelDiscordAdapter({ config: discordConnectorSchema.parse(config) })
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
