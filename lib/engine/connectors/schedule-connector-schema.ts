import { z } from "zod"
import { validateCronExpression } from "@/engine/connectors/match-cron"

/**
 * Catch-up behavior when the daemon was down past one or more matching minutes.
 *
 * - `latest`: fire once with the most recent missed match (default; preserves prior behavior).
 * - `all`: fire once per missed minute, oldest first (capped at 24 h).
 * - `skip`: never fire missed matches; only fire when the current minute matches.
 */
export const scheduleCatchupPolicySchema = z.enum(["latest", "all", "skip"])

export type ScheduleCatchupPolicy = z.infer<typeof scheduleCatchupPolicySchema>

export const cronExpressionSchema = z.string().superRefine((expression, context) => {
  try {
    validateCronExpression(expression)
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

const scheduleEntryBaseSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  enabled: z.boolean().default(true),
  catchupPolicy: scheduleCatchupPolicySchema.default("latest"),
  createdAt: z.string().datetime().optional(),
})

const scheduleEntryInputBaseSchema = z.object({
  id: z.string().optional(),
  prompt: z.string(),
  enabled: z.boolean().optional(),
  catchupPolicy: scheduleCatchupPolicySchema.optional(),
})

const cronScheduleEntryInputSchema = scheduleEntryInputBaseSchema
  .extend({
    cron: cronExpressionSchema,
  })
  .strict()

const onceScheduleEntryInputSchema = scheduleEntryInputBaseSchema
  .extend({
    runAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const scheduleEntryInputSchema = z.union([
  onceScheduleEntryInputSchema,
  cronScheduleEntryInputSchema,
])

export type ScheduleEntryInput = z.input<typeof scheduleEntryInputSchema>

export const cronScheduleEntrySchema = scheduleEntryBaseSchema.extend({
  kind: z.literal("cron").default("cron"),
  cron: cronExpressionSchema,
})

export const onceScheduleEntrySchema = scheduleEntryBaseSchema.extend({
  kind: z.literal("once"),
  runAt: z.string().datetime({ offset: true }),
})

export const scheduleEntrySchema = z.union([onceScheduleEntrySchema, cronScheduleEntrySchema])

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>
export type CronScheduleEntry = z.infer<typeof cronScheduleEntrySchema>
export type OnceScheduleEntry = z.infer<typeof onceScheduleEntrySchema>

export const scheduleConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("schedule"),
  entries: z.array(scheduleEntrySchema).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type ScheduleConnectorConfig = z.infer<typeof scheduleConnectorSchema>
