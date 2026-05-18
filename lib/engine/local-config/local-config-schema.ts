import { z } from "zod"

/**
 * Per-repo launch config. When `fnl claude` runs with no --profile / --channel,
 * it reads `funnel.json` from the cwd and uses these fields to launch.
 *
 * Only `channel` is required — it must match an existing channel name in
 * ~/.funnel/settings.json. The channel itself (and any tokens) stays
 * machine-global; this file only declares what the repo subscribes to.
 */
export const localConfigSchema = z.object({
  channel: z.string(),
  subAgent: z.string().optional(),
  brief: z.boolean().optional(),
})

export type LocalConfig = z.infer<typeof localConfigSchema>

export const LOCAL_CONFIG_FILENAME = "funnel.json"
