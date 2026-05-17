import type { ConnectorConfig } from "@/connectors/connector-config-schema"
import type { ChannelConfig } from "@/engine/settings/settings-schema"

function isConnectorOfType<T extends ConnectorConfig["type"]>(
  connector: ConnectorConfig,
  type: T,
): connector is Extract<ConnectorConfig, { type: T }> {
  return connector.type === type
}

/**
 * Look up a connector by name and narrow its discriminated union to a single
 * variant via a type predicate. Throws if the connector is missing or has the
 * wrong `type`. Replaces per-type `requireXxxConnector` privates — adding a
 * new connector type only touches the `ConnectorConfig` union, not this
 * helper.
 */
export function requireConnectorOfType<T extends ConnectorConfig["type"]>(
  channel: ChannelConfig,
  connectorName: string,
  type: T,
): Extract<ConnectorConfig, { type: T }> {
  const connector = channel.connectors.find((c) => c.name === connectorName)

  if (!connector) {
    throw new Error(`connector "${connectorName}" not found in channel "${channel.name}"`)
  }

  if (!isConnectorOfType(connector, type)) {
    throw new Error(`connector "${connectorName}" is type "${connector.type}", not "${type}"`)
  }

  return connector
}
