import type { ChannelConfig } from "@/engine/settings/settings-schema"

export type ChannelResolver = {
  get(name: string): ChannelConfig | null
  getById(id: string): ChannelConfig | null
}
