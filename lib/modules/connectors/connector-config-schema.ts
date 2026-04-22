import { z } from "zod"
import { discordConnectorSchema } from "@/modules/connectors/discord-connector-schema"
import { ghConnectorSchema } from "@/modules/connectors/gh-connector-schema"
import { scheduleConnectorSchema } from "@/modules/connectors/schedule-connector-schema"
import { slackConnectorSchema } from "@/modules/connectors/slack-connector-schema"

export const connectorConfigSchema = z.discriminatedUnion("type", [
  slackConnectorSchema,
  ghConnectorSchema,
  discordConnectorSchema,
  scheduleConnectorSchema,
])

export type ConnectorConfig = z.infer<typeof connectorConfigSchema>

export type ConnectorType = ConnectorConfig["type"]
