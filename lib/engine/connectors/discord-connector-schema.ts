import { z } from "zod"

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
