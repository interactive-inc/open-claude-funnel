import { z } from "zod"

export const ghConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("gh"),
  pollInterval: z.number().int().positive().optional(),
  /**
   * Explicit PAT/OAuth token. When neither this nor `tokenEnv` is set, the
   * listener falls back to `gh auth token`, reusing the `gh` CLI's session.
   */
  token: z.string().optional(),
  /** Name of an env var to read the token from at start time. */
  tokenEnv: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type GhConnectorConfig = z.infer<typeof ghConnectorSchema>
