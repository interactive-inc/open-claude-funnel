import { z } from "zod"

export const slackConnectorSchema = z.object({
  type: z.literal("slack"),
  name: z.string(),
  botToken: z.string().startsWith("xoxb-"),
  appToken: z.string().startsWith("xapp-"),
})

export type SlackConnectorConfig = z.infer<typeof slackConnectorSchema>
