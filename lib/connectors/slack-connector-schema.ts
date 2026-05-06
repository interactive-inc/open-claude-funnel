import { z } from "zod";

export const slackConnectorSchema = z.object({
  type: z.literal("slack"),
  name: z.string(),
  botToken: z.string().startsWith("xoxb-"),
  appToken: z.string().startsWith("xapp-"),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type SlackConnectorConfig = z.infer<typeof slackConnectorSchema>;
