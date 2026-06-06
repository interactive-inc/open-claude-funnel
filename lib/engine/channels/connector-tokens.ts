import type { ConnectorConfig } from "@/engine/connectors/connector-config-schema"

/**
 * Return every literal secret token contained in a connector config. Used by
 * token collision detection at add/update time so the same Slack bot or
 * Discord bot cannot be registered under two connectors. Connectors that hold
 * an env *reference* instead of a literal contribute nothing here — two
 * connectors naming the same env var is not a secret collision, and the secret
 * is not in settings.json to compare anyway.
 */
export function connectorTokens(connector: ConnectorConfig): string[] {
  switch (connector.type) {
    case "slack":
      return [connector.botToken, connector.appToken].filter((token) => token !== undefined)
    case "discord":
      return [connector.botToken].filter((token) => token !== undefined)
    case "gh":
    case "schedule":
      return []
  }
}
