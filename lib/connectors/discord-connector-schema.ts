import { z } from "zod"

export const discordConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("discord"),
  botToken: z.string().min(10),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type DiscordConnectorConfig = z.infer<typeof discordConnectorSchema>
