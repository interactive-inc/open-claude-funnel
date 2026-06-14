import { z } from "zod"

/**
 * Fields every connector config carries, regardless of type. The discriminated
 * union of concrete connector configs no longer lives in core: each connector
 * type owns its full schema inside its descriptor, and core handles connectors
 * through this base shape plus the injected registry. `type` is an open string
 * here on purpose — core does not enumerate the known connector types.
 */
export const baseConnectorConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type BaseConnectorConfig = z.infer<typeof baseConnectorConfigSchema>
