import { z } from "zod"

export const scheduleEntrySchema = z.object({
  id: z.string(),
  cron: z.string(),
  prompt: z.string(),
  enabled: z.boolean().default(true),
})

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>

export const scheduleConnectorSchema = z.object({
  type: z.literal("schedule"),
  name: z.string(),
  entries: z.array(scheduleEntrySchema).default([]),
})

export type ScheduleConnectorConfig = z.infer<typeof scheduleConnectorSchema>
