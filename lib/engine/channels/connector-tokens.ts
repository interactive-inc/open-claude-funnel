import type { ConnectorConfig } from "@/connectors/connector-config-schema"

/**
 * Return every secret token contained in a connector config. Used by token
 * collision detection at add/update time so the same Slack bot or Discord
 * bot cannot be registered under two connectors. Centralizes the per-type
 * switch so the channels facade does not embed type-specific knowledge.
 */
export function connectorTokens(connector: ConnectorConfig): string[] {
  switch (connector.type) {
    case "slack":
      return [connector.botToken, connector.appToken]
    case "discord":
      return [connector.botToken]
    case "gh":
    case "schedule":
      return []
  }
}
