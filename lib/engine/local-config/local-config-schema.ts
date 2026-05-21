import { z } from "zod"

/**
 * Per-repo launch config (`funnel.json`).
 *
 * `fnl claude` reads this when no --profile is given and picks one of the
 * declared channels (`--channel <name>` selects by name; otherwise the first
 * entry wins). The chosen channel is materialized into
 * `~/.funnel/settings.json` on launch — token fields in connectors resolve
 * via literal / `env.<field>` / TTY prompt.
 *
 * Top-level `options` and `env` are defaults shared by every channel: each
 * channel's own `options` is appended after the shared ones (CLI semantics
 * keep the later flag winning), and `env` is a shallow merge with the
 * channel's keys overriding the shared ones.
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
  /** Shrink raw Slack events before fanout. Defaults to true. */
  minify: z.boolean().optional(),
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

export const channelSpecSchema = z.object({
  name: z.string(),
  /** Args prepended to the claude argv on every launch bound to this channel. */
  options: z.array(z.string()).optional(),
  /** Env vars layered under the launched claude process. process.env wins on collision. */
  env: z.record(z.string(), z.string()).optional(),
  /**
   * When true (the default), funnel injects `--session-id <uuid>` so that
   * relaunching from the same cwd resumes the previous claude session
   * without bleeding into other channels or workspaces. Set to false for
   * channels that should always start a fresh session.
   */
  resume: z.boolean().optional(),
  connectors: z.array(connectorSpecSchema).optional(),
})

export type ChannelSpec = z.infer<typeof channelSpecSchema>

export const localConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Declared channels. First entry is the default; --channel <name> selects by name. */
  channels: z.array(channelSpecSchema).min(1),
})

export type LocalConfig = z.infer<typeof localConfigSchema>

export const LOCAL_CONFIG_FILENAME = "funnel.json"

export const LOCAL_ENV_FILENAME = ".env.local"
