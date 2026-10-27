import { z } from "zod"

export const slackConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("slack"),
  botToken: z.string().startsWith("xoxb-").optional(),
  appToken: z.string().startsWith("xapp-").optional(),
  /** Name of the env var holding the bot token, resolved at listener start. */
  botTokenEnv: z.string().optional(),
  /** Name of the env var holding the app token, resolved at listener start. */
  appTokenEnv: z.string().optional(),
  minify: z.boolean().default(true),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type SlackConnectorConfig = z.infer<typeof slackConnectorSchema>
