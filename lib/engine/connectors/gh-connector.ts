import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { ghConnectorSchema } from "@/engine/connectors/gh-connector-schema"
import { FunnelFlumeGhListener } from "@/engine/connectors/gh-flume-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { slotFields } from "@/engine/connectors/slot-fields"

/**
 * GitHub connector descriptor. Pass `ghConnector()` to
 * `new Funnel({ connectors: [...] })` to enable the type.
 *
 * The listener is backed by `@interactive-inc/flume`'s `FlumeGitHubSource`
 * (raw REST polling + Zod), authenticating with a token resolved from the
 * environment or `gh auth token`. The adapter still uses `gh api` for
 * outbound calls, so the auth model is unchanged end-to-end.
 */
export const ghConnector = (): ConnectorDescriptor => ({
  type: "gh",
  toolExposed: true,
  createListener(config, deps) {
    return new FunnelFlumeGhListener({
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
  secretTokens(config) {
    const parsed = ghConnectorSchema.parse(config)

    return [parsed.token].filter((token) => token !== undefined)
  },
  buildConfig(input, context) {
    return ghConnectorSchema.parse({
      id: context.id,
      type: "gh",
      name: input.name,
      ...(typeof input.pollInterval === "number" ? { pollInterval: input.pollInterval } : {}),
      ...(typeof input.token === "string" ? { token: input.token } : {}),
      ...(typeof input.tokenEnv === "string" ? { tokenEnv: input.tokenEnv } : {}),
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
        typeof fields.pollInterval === "number" ? fields.pollInterval : current.pollInterval,
      createdAt: current.createdAt,
      updatedAt: context.now,
      ...slotFields("token", "tokenEnv", fields, current),
    })
  },
  operations: {},
})
