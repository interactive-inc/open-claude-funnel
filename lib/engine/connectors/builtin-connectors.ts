import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { discordConnector } from "@/engine/connectors/discord-connector"
import { ghConnector } from "@/engine/connectors/gh-connector"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { slackConnector } from "@/engine/connectors/slack-connector"

export const builtinConnectors = (): ConnectorDescriptor[] => [
  slackConnector(),
  ghConnector(),
  discordConnector(),
  scheduleConnector(),
]
