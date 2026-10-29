import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { ghConnectorSchema } from "@/engine/connectors/gh-connector-schema"
import { FunnelFlumeGhListener } from "@/engine/connectors/gh-flume-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { slotFields } from "@/engine/connectors/slot-fields"

const creationFieldsSchema = ghConnectorSchema.pick({
  pollInterval: true,
  token: true,
  tokenEnv: true,
})

/** GitHub REST connector. Credentials are supplied by the host. */
export const ghConnector = (): ConnectorDescriptor => ({
  type: "gh",
  toolExposed: true,
  createListener(config, deps) {
    return new FunnelFlumeGhListener({
      config: ghConnectorSchema.parse(config),
      channelId: deps.channelId,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
      signal: deps.signal,
    })
  },
  createAdapter(config, deps) {
    return new FunnelGhAdapter({ config: ghConnectorSchema.parse(config), http: deps.http })
  },
  secretTokens(config) {
    const parsed = ghConnectorSchema.parse(config)

    return [parsed.token].filter((token) => token !== undefined)
  },
  buildConfig(input, context) {
    return ghConnectorSchema.parse({
      id: context.id,
      type: "gh",
      name: input.name,
      ...creationFieldsSchema.parse(input),
      createdAt: context.now,
      updatedAt: context.now,
    })
  },
  applyUpdate(config, fields, context) {
    const current = ghConnectorSchema.parse(config)

    return ghConnectorSchema.parse({
      id: current.id,
      name: current.name,
      type: "gh",
      pollInterval:
        ghConnectorSchema.shape.pollInterval.parse(fields.pollInterval) ?? current.pollInterval,
      createdAt: current.createdAt,
      updatedAt: context.now,
      ...slotFields({ literalKey: "token", envKey: "tokenEnv" }, fields, current),
    })
  },
  operations: {},
})
