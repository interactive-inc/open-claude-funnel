import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { settingsSchema } from "@/engine/settings/settings-schema"

export type ChannelConnectorsView = {
  channelName: string
  connectors: { name: string; type: string }[]
}

/**
 * Reads the connectors of one channel from settings.json, keeping only the
 * tool-exposed types. The exposed set is supplied by the caller (the MCP server
 * builds it from the connector descriptors it imports) — core does not enumerate
 * connector types here.
 */
export const readChannelConnectors = (
  dir: string,
  channelId: string,
  toolConnectorTypes: Set<string>,
): ChannelConnectorsView | null => {
  const settingsPath = join(dir, "settings.json")

  if (!existsSync(settingsPath)) return null

  const raw = JSON.parse(readFileSync(settingsPath, "utf-8"))
  const parsed = settingsSchema.safeParse(raw)

  if (!parsed.success) return null

  const channel = parsed.data.channels.find((c) => c.id === channelId)

  if (!channel) return null

  const connectors = channel.connectors
    .filter((c) => toolConnectorTypes.has(c.type))
    .map((c) => ({ name: c.name, type: c.type }))

  return { channelName: channel.name, connectors }
}
