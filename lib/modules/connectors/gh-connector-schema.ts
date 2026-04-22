import { z } from "zod"

export const ghConnectorSchema = z.object({
  type: z.literal("gh"),
  name: z.string(),
  pollInterval: z.number().int().positive().optional(),
})

export type GhConnectorConfig = z.infer<typeof ghConnectorSchema>
