import { z } from "zod";

export const ghConnectorSchema = z.object({
  type: z.literal("gh"),
  name: z.string(),
  pollInterval: z.number().int().positive().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type GhConnectorConfig = z.infer<typeof ghConnectorSchema>;
