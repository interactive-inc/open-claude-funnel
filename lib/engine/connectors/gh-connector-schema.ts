import { z } from "zod"

export const ghConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("gh"),
  pollInterval: z.number().int().positive().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type GhConnectorConfig = z.infer<typeof ghConnectorSchema>
