import { z } from "zod"

/**
 * Per-repo launch config (`funnel.json`).
 *
 * `fnl claude` reads this when no global --profile preset is used. It picks one
 * of the declared channels (`--channel <name>` selects by name; otherwise the
 * first entry wins) and materializes its transport (connectors / delivery) into
 * `~/.funnel/settings.json` on launch — token fields in connectors resolve via
 * literal / `env.<field>` / TTY prompt.
 *
 * The launch recipe (`options` / `env` / `resume`) lives on `profiles[]`, not on
 * the channel: a channel only describes where events come from. `fnl claude`
 * applies the first profile bound to the chosen channel (or `--profile <name>`
 * to pick another); the recipe is passed straight to the launcher and is not
 * persisted into the global profile list.
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
  connectors: z.array(connectorSpecSchema).optional(),
})

export type ChannelSpec = z.infer<typeof channelSpecSchema>

export const profileSpecSchema = z.object({
  name: z.string(),
  /** Name of the channel (declared in `channels[]`) this profile subscribes to. */
  channel: z.string(),
  /** Args prepended to the claude argv on every launch through this profile. */
  options: z.array(z.string()).optional(),
  /** Env vars layered under the launched claude process. process.env wins on collision. */
  env: z.record(z.string(), z.string()).optional(),
  /**
   * When true (the default), funnel injects `--session-id <uuid>` so that
   * relaunching from the same cwd resumes the previous claude session
   * without bleeding into other channels or workspaces. Set to false for
   * profiles that should always start a fresh session.
   */
  resume: z.boolean().optional(),
})

export type ProfileSpec = z.infer<typeof profileSpecSchema>

export const localConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Declared channels (transport only). First entry is the default; --channel <name> selects by name. */
  channels: z.array(channelSpecSchema).min(1),
  /** Launch presets bound to a channel. First entry bound to the chosen channel is the default. */
  profiles: z.array(profileSpecSchema).optional(),
})

export type LocalConfig = z.infer<typeof localConfigSchema>

export const LOCAL_CONFIG_FILENAME = "funnel.json"

export const LOCAL_ENV_FILENAME = ".env.local"
