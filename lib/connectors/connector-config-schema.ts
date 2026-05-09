import { z } from "zod"
import { discordConnectorSchema } from "@/connectors/discord-connector-schema"
import { ghConnectorSchema } from "@/connectors/gh-connector-schema"
import { scheduleConnectorSchema } from "@/connectors/schedule-connector-schema"
import { slackConnectorSchema } from "@/connectors/slack-connector-schema"

export const connectorConfigSchema = z.discriminatedUnion("type", [
  slackConnectorSchema,
  ghConnectorSchema,
  discordConnectorSchema,
  scheduleConnectorSchema,
])

export type ConnectorConfig = z.infer<typeof connectorConfigSchema>

export type ConnectorType = ConnectorConfig["type"]
