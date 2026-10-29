import { z } from "zod"
import { baseConnectorConfigSchema } from "@/engine/connectors/base-connector-config"

/**
 * Connectors are stored loosely here: settings validates only the common base
 * fields and preserves every type-specific key verbatim (`.loose()`).
 * Core does not enumerate connector types, so strict per-type validation happens
 * at the registry/descriptor layer (CRUD time), not on every settings read.
 */
const storedConnectorSchema = baseConnectorConfigSchema
  .extend({ id: z.string().min(1, "connector ID must not be empty") })
  .loose()

/**
 * Routing mode when multiple WS clients are subscribed to the same channel.
 *
 * - `fanout` (default): every connected client receives every event. Right when each
 *   subscriber has its own job (e.g., observers or independent agents each running
 *   their own pipeline against the same source).
 * - `exclusive`: each event is delivered to exactly one connected client, picked
 *   round-robin per channel. Right when subscribers are interchangeable workers and you
 *   want each event handled once. Targeted events retain the same recipient across replay.
 */
export const channelDeliveryModeSchema = z.enum(["fanout", "exclusive"])

export type ChannelDeliveryMode = z.infer<typeof channelDeliveryModeSchema>

export const channelConfigSchema = z.object({
  id: z.string().min(1, "channel ID must not be empty"),
  name: z.string(),
  delivery: channelDeliveryModeSchema.default("fanout"),
  connectors: z
    .array(storedConnectorSchema)
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, {
      message: "connector IDs must be unique within a channel",
    })
    .refine((rows) => new Set(rows.map((row) => row.name)).size === rows.length, {
      message: "connector names must be unique within a channel",
    })
    .default([]),
})

export type ChannelConfig = z.infer<typeof channelConfigSchema>

export const settingsSchema = z.object({
  channels: z
    .array(channelConfigSchema)
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, {
      message: "channel IDs must be unique",
    })
    .refine((rows) => new Set(rows.map((row) => row.name)).size === rows.length, {
      message: "channel names must be unique",
    })
    .default([]),
})
export type Settings = z.infer<typeof settingsSchema>
