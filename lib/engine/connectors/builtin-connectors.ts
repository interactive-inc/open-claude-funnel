import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { discordConnector } from "@/engine/connectors/discord-connector"
import { ghConnector } from "@/engine/connectors/gh-connector"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { slackConnector } from "@/engine/connectors/slack-connector"

/**
 * The four built-in connector descriptors. Importing this pulls every connector
 * SDK (@slack/bolt, discord.js, …) into the bundle, so it is used ONLY by
 * full-bundle entry points (the `fnl` CLI, the gateway daemon, the MCP server) —
 * never by the library's public barrel. Programmatic hosts pass the descriptors
 * they actually need to `new Funnel({ connectors: [...] })` instead.
 */
export const builtinConnectors = (): ConnectorDescriptor[] => [
  slackConnector(),
  ghConnector(),
  discordConnector(),
  scheduleConnector(),
]
