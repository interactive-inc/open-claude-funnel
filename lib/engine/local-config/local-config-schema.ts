import { z } from "zod"

/**
 * Per-repo launch config (`funnel.json`).
 *
 * `fnl claude` reads this when no --profile / --channel is given and uses it
 * to set the channel binding, sub-agent, and brief flag. When `connectors`
 * is declared, missing channels/connectors are materialized into the local
 * `~/.funnel/settings.json` on launch — token fields are resolved from
 * `$VAR` references (process env + `.env.local`) or prompted for once and
 * persisted.
 *
 * Only `channel` is required. The file is intended to be committed; tokens
 * stay machine-global (in env or `~/.funnel`).
 */

const slackConnectorSpecSchema = z.object({
  type: z.literal("slack"),
  name: z.string(),
  botToken: z.string().optional(),
  appToken: z.string().optional(),
})

const discordConnectorSpecSchema = z.object({
  type: z.literal("discord"),
  name: z.string(),
  botToken: z.string().optional(),
})

const ghConnectorSpecSchema = z.object({
  type: z.literal("gh"),
  name: z.string(),
  pollInterval: z.number().int().positive().optional(),
})

const scheduleConnectorSpecSchema = z.object({
  type: z.literal("schedule"),
  name: z.string(),
})

export const connectorSpecSchema = z.discriminatedUnion("type", [
  slackConnectorSpecSchema,
  discordConnectorSpecSchema,
  ghConnectorSpecSchema,
  scheduleConnectorSpecSchema,
])

export type ConnectorSpec = z.infer<typeof connectorSpecSchema>

export const localConfigSchema = z.object({
  channel: z.string(),
  subAgent: z.string().optional(),
  brief: z.boolean().optional(),
  connectors: z.array(connectorSpecSchema).optional(),
})

export type LocalConfig = z.infer<typeof localConfigSchema>

export const LOCAL_CONFIG_FILENAME = "funnel.json"

export const LOCAL_ENV_FILENAME = ".env.local"
