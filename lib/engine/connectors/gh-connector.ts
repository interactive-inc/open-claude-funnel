import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { ghConnectorSchema } from "@/engine/connectors/gh-connector-schema"
import { FunnelGhListener } from "@/engine/connectors/gh-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"

/**
 * GitHub connector descriptor. Pass `ghConnector()` to
 * `new Funnel({ connectors: [...] })` to enable the type.
 */
export const ghConnector = (): ConnectorDescriptor => ({
  type: "gh",
  toolExposed: true,
  createListener(config, deps) {
    return new FunnelGhListener({
      config: ghConnectorSchema.parse(config),
      channelId: deps.channelId,
      process: deps.process,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
    })
  },
  createAdapter(config, deps) {
    ghConnectorSchema.parse(config)

    return new FunnelGhAdapter({ process: deps.process })
  },
  secretTokens() {
    return []
  },
  buildConfig(input, context) {
    return ghConnectorSchema.parse({
      id: context.id,
      type: "gh",
      name: input.name,
      ...(typeof input.pollInterval === "number" ? { pollInterval: input.pollInterval } : {}),
      createdAt: context.now,
      updatedAt: context.now,
    })
  },
  applyUpdate(config, fields, context) {
    const current = ghConnectorSchema.parse(config)

    return ghConnectorSchema.parse({
      ...current,
      ...(typeof fields.pollInterval === "number" ? { pollInterval: fields.pollInterval } : {}),
      updatedAt: context.now,
    })
  },
  operations: {},
})
