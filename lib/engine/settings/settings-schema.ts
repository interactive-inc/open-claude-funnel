import { z } from "zod"
import { baseConnectorConfigSchema } from "@/engine/connectors/base-connector-config"

/**
 * Connectors are stored loosely here: settings validates only the common base
 * fields and preserves every type-specific key verbatim (`.loose()`).
 * Core does not enumerate connector types, so strict per-type validation happens
 * at the registry/descriptor layer (CRUD time), not on every settings read.
 */
const storedConnectorSchema = baseConnectorConfigSchema.loose()

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
  id: z.string(),
  name: z.string(),
  delivery: channelDeliveryModeSchema.default("fanout"),
  connectors: z.array(storedConnectorSchema).default([]),
})

export type ChannelConfig = z.infer<typeof channelConfigSchema>

export const settingsSchema = z.object({
  channels: z.array(channelConfigSchema).default([]),
})
export type Settings = z.infer<typeof settingsSchema>
