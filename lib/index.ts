export {
  Funnel,
  type FunnelOptions,
  type FunnelChannelOptions,
  type GatewayModuleOptions,
  type GatewayServerOptions,
} from "@/funnel"
export { FunnelChannels } from "@/engine/channels/channels"
export { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
export { FunnelSettingsReader } from "@/engine/settings/settings-reader"
export {
  channelConfigSchema,
  type ChannelConfig,
  type ChannelDeliveryMode,
  type Settings,
} from "@/engine/settings/settings-schema"
export * from "@/engine/connectors/connector-adapter"
export * from "@/engine/connectors/connector-listener"
export * from "@/engine/connectors/connector-descriptor"
export * from "@/engine/connectors/base-connector-config"
export * from "@/engine/error/funnel-error"
export * from "@/engine/error/on-funnel-error"
export * from "@/gateway/channel-ws-url"
// Public injection contracts used by connector hosts.
export * from "@/engine/http/http-client"
export * from "@/engine/time/clock"
