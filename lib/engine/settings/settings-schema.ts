import { z } from "zod"
import { connectorConfigSchema } from "@/connectors/connector-config-schema"

/**
 * Routing mode when multiple WS clients are subscribed to the same channel.
 *
 * - `fanout` (default): every connected client receives every event. Right when each
 *   subscriber has its own job (e.g., TUI mirrors, distinct Claude profiles each running
 *   their own pipeline against the same source).
 * - `exclusive`: each event is delivered to exactly one connected client, picked
 *   round-robin per channel. Right when subscribers are interchangeable workers and you
 *   want each event handled once. Tap=all clients (TUI dashboard) always receive,
 *   regardless of mode, so they can passively observe.
 */
export const channelDeliveryModeSchema = z.enum(["fanout", "exclusive"])

export type ChannelDeliveryMode = z.infer<typeof channelDeliveryModeSchema>

export const channelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  delivery: channelDeliveryModeSchema.default("fanout"),
  connectors: z.array(connectorConfigSchema).default([]),
})

export type ChannelConfig = z.infer<typeof channelConfigSchema>

export const profileConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  channelId: z.string(),
  /** Args prepended to the claude argv on every launch through this profile. */
  options: z.array(z.string()).default([]),
  /** Env vars layered under the launched claude process. process.env wins on collision. */
  env: z.record(z.string(), z.string()).default({}),
  /**
   * When true (the default), funnel injects `--session-id <uuid>` so that
   * relaunching from the same cwd resumes the previous claude session.
   * Set to false for profiles that should always start a fresh session.
   */
  resume: z.boolean().default(true),
})

export type ProfileConfig = z.infer<typeof profileConfigSchema>

export const SETTINGS_VERSION = 1

export const settingsSchema = z.object({
  /** Schema version. New files always write the current version; older files without one are read as v1. */
  version: z.literal(SETTINGS_VERSION).default(SETTINGS_VERSION),
  channels: z.array(channelConfigSchema).default([]),
  profiles: z.array(profileConfigSchema).default([]),
})

export type Settings = z.infer<typeof settingsSchema>
