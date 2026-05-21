import { z } from "zod"

export const slackConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("slack"),
  botToken: z.string().startsWith("xoxb-"),
  appToken: z.string().startsWith("xapp-"),
  minify: z.boolean().default(true),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type SlackConnectorConfig = z.infer<typeof slackConnectorSchema>
