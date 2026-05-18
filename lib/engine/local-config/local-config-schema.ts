import { z } from "zod"

/**
 * Per-repo launch config (`funnel.json`).
 *
 * `fnl claude` reads this when no --profile / --channel is given and uses it
 * to set the channel binding, sub-agent, and brief flag. When `connectors`
 * is declared, missing channels/connectors are materialized into the local
 * `~/.funnel/settings.json` on launch.
 *
 * Token fields per connector resolve in this order:
 *
 *   1. Literal value at the field itself (e.g. `botToken: "xoxb-..."`)
 *   2. Env-var reference at `env.<field>` (e.g. `env: { botToken: "SLACK_BOT_TOKEN" }`);
 *      resolved from process.env first, then ./.env.local
 *   3. Field omitted everywhere → prompted for once on a TTY and persisted to
 *      `~/.funnel/settings.json`; non-TTY launches fail fast.
 *
 * `funnel.json` itself is never written to. Only `channel` is required.
 */

const slackEnvSchema = z
  .object({
    botToken: z.string().optional(),
    appToken: z.string().optional(),
  })
  .optional()

const slackConnectorSpecSchema = z.object({
  type: z.literal("slack"),
  name: z.string(),
  botToken: z.string().optional(),
  appToken: z.string().optional(),
  env: slackEnvSchema,
})

const discordEnvSchema = z
  .object({
    botToken: z.string().optional(),
  })
  .optional()

const discordConnectorSpecSchema = z.object({
  type: z.literal("discord"),
  name: z.string(),
  botToken: z.string().optional(),
  env: discordEnvSchema,
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
