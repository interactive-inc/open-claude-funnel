import { FunnelConnectorListener } from "@/modules/connectors/funnel-connector-listener"
import { FunnelDiscordListener } from "@/modules/connectors/funnel-discord-listener"
import { FunnelGhListener } from "@/modules/connectors/funnel-gh-listener"
import { FunnelSlackListener } from "@/modules/connectors/funnel-slack-listener"
import type { ConnectorConfig } from "@/modules/settings/settings-schema"

export const resolveListener = (config: ConnectorConfig): FunnelConnectorListener => {
  if (config.type === "slack") return new FunnelSlackListener({ config })
  if (config.type === "gh") return new FunnelGhListener({ config })
  if (config.type === "discord") return new FunnelDiscordListener({ config })

  throw new Error(`unsupported connector type: ${(config as { type: string }).type}`)
}
