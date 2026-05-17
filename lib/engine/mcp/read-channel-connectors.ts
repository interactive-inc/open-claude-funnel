import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { settingsSchema } from "@/engine/settings/settings-schema"

const TOOL_CONNECTOR_TYPES = new Set(["slack", "gh", "discord"])

export type ChannelConnectorsView = {
  channelName: string
  connectors: { name: string; type: string }[]
}

export const readChannelConnectors = (
  dir: string,
  channelId: string,
): ChannelConnectorsView | null => {
  const settingsPath = join(dir, "settings.json")

  if (!existsSync(settingsPath)) return null

  const raw = JSON.parse(readFileSync(settingsPath, "utf-8"))
  const parsed = settingsSchema.safeParse(raw)

  if (!parsed.success) return null

  const channel = parsed.data.channels.find((c) => c.id === channelId)

  if (!channel) return null

  const connectors = channel.connectors
    .filter((c) => TOOL_CONNECTOR_TYPES.has(c.type))
    .map((c) => ({ name: c.name, type: c.type }))

  return { channelName: channel.name, connectors }
}
