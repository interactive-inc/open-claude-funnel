import { z } from "zod"

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
  channels: z.array(channelConfigSchema).default([]),
  repositories: z.array(repositoryConfigSchema).default([]),
  profiles: z.array(profileConfigSchema).default([]),
})

export type Settings = z.infer<typeof settingsSchema>
