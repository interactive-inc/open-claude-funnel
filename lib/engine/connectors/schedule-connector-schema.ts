import { z } from "zod"

/**
 * Catch-up behavior when the daemon was down past one or more matching minutes.
 *
 * - `latest`: fire once with the most recent missed match (default; preserves prior behavior).
 * - `all`: fire once per missed minute, oldest first (capped at 24 h).
 * - `skip`: never fire missed matches; only fire when the current minute matches.
 */
export const scheduleCatchupPolicySchema = z.enum(["latest", "all", "skip"])

export type ScheduleCatchupPolicy = z.infer<typeof scheduleCatchupPolicySchema>

export const scheduleEntrySchema = z.object({
  id: z.string(),
  cron: z.string(),
  prompt: z.string(),
  enabled: z.boolean().default(true),
  catchupPolicy: scheduleCatchupPolicySchema.default("latest"),
})

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>

export const scheduleConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("schedule"),
  entries: z.array(scheduleEntrySchema).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type ScheduleConnectorConfig = z.infer<typeof scheduleConnectorSchema>
