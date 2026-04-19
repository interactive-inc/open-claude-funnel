import { z } from "zod"

export const slackConnectorSchema = z.object({
  type: z.literal("slack"),
  name: z.string(),
  botToken: z.string().startsWith("xoxb-"),
  appToken: z.string().startsWith("xapp-"),
})

export type SlackConnectorConfig = z.infer<typeof slackConnectorSchema>

export const ghConnectorSchema = z.object({
  type: z.literal("gh"),
  name: z.string(),
  pollInterval: z.number().int().positive().optional(),
})

export type GhConnectorConfig = z.infer<typeof ghConnectorSchema>

export const discordConnectorSchema = z.object({
  type: z.literal("discord"),
  name: z.string(),
  botToken: z.string().min(10),
})

export type DiscordConnectorConfig = z.infer<typeof discordConnectorSchema>

export const connectorConfigSchema = z.discriminatedUnion("type", [
  slackConnectorSchema,
  ghConnectorSchema,
  discordConnectorSchema,
])

export type ConnectorConfig = z.infer<typeof connectorConfigSchema>

export const channelConfigSchema = z.object({
  name: z.string(),
  connectors: z.array(z.string()).default([]),
})

export type ChannelConfig = z.infer<typeof channelConfigSchema>

export const repositoryConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
})

export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>

export const profileConfigSchema = z.object({
  name: z.string(),
  channel: z.string(),
  repo: z.string().optional(),
  subAgent: z.string().optional(),
  envFiles: z.array(z.string()).optional(),
})

export type ProfileConfig = z.infer<typeof profileConfigSchema>

export const settingsSchema = z.object({
  connectors: z.array(connectorConfigSchema).default([]),
  channels: z.array(channelConfigSchema).default([]),
  repositories: z.array(repositoryConfigSchema).default([]),
  profiles: z.array(profileConfigSchema).default([]),
})

export type Settings = z.infer<typeof settingsSchema>
