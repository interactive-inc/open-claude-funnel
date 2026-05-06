import { z } from "zod";

export const discordConnectorSchema = z.object({
  type: z.literal("discord"),
  name: z.string(),
  botToken: z.string().min(10),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type DiscordConnectorConfig = z.infer<typeof discordConnectorSchema>;
