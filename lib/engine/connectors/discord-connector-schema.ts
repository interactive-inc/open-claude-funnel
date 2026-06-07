import { z } from "zod"

/**
 * Like slack, a discord connector holds either a literal `botToken` or a
 * `botTokenEnv` reference resolved from `process.env` at listener start. The
 * reference form keeps the secret out of settings.json, but is only set through
 * the engine API (`new Funnel(...)`); funnel.json and the `fnl` CLI produce
 * literals.
 */
export const discordConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("discord"),
  botToken: z.string().min(10).optional(),
  /** Name of the env var holding the bot token, resolved at listener start. */
  botTokenEnv: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type DiscordConnectorConfig = z.infer<typeof discordConnectorSchema>
