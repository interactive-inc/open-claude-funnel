import { z } from "zod"

export const discordConnectorSchema = z.object({
  type: z.literal("discord"),
  name: z.string(),
  botToken: z.string().min(10),
})

export type DiscordConnectorConfig = z.infer<typeof discordConnectorSchema>
