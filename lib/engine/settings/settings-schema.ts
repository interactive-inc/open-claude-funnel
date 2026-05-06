import { z } from "zod";

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
  name: z.string(),
  connectors: z.array(z.string()).default([]),
  delivery: channelDeliveryModeSchema.default("fanout"),
});

export type ChannelConfig = z.infer<typeof channelConfigSchema>;

export const repositoryConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
});

export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;

export const profileConfigSchema = z.object({
  name: z.string(),
  channel: z.string(),
  repo: z.string().optional(),
  subAgent: z.string().optional(),
  envFiles: z.array(z.string()).optional(),
});

export type ProfileConfig = z.infer<typeof profileConfigSchema>;

export const SETTINGS_VERSION = 1;

export const settingsSchema = z.object({
  /** Schema version. New files always write the current version; older files without one are read as v1. */
  version: z.literal(SETTINGS_VERSION).default(SETTINGS_VERSION),
  channels: z.array(channelConfigSchema).default([]),
  repositories: z.array(repositoryConfigSchema).default([]),
  profiles: z.array(profileConfigSchema).default([]),
});

export type Settings = z.infer<typeof settingsSchema>;
