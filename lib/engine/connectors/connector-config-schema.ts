import { z } from "zod"
import { discordConnectorSchema } from "@/engine/connectors/discord-connector-schema"
import { ghConnectorSchema } from "@/engine/connectors/gh-connector-schema"
import { scheduleConnectorSchema } from "@/engine/connectors/schedule-connector-schema"
import { slackConnectorSchema } from "@/engine/connectors/slack-connector-schema"

export const connectorConfigSchema = z.discriminatedUnion("type", [
  slackConnectorSchema,
  ghConnectorSchema,
  discordConnectorSchema,
  scheduleConnectorSchema,
])

export type ConnectorConfig = z.infer<typeof connectorConfigSchema>

export type ConnectorType = ConnectorConfig["type"]
