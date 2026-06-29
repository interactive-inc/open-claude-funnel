// Channel manifest API — sources を `FlumeConfluence` に挿し broadcaster に流す薄いレイヤー。
// 既存の ConnectorDescriptor 系 (`@interactive-inc/claude-funnel/connectors/*`) とは独立。
//
// 使い方:
//   import { FunnelChannelSupervisor, timeChannel } from "@interactive-inc/claude-funnel/channel"
//
//   const supervisor = new FunnelChannelSupervisor({
//     broadcaster: gatewayServer.getBroadcaster(),
//     logger, clock, fs, dir,
//   })
//
//   supervisor.register(timeChannel({
//     id: "inta-jiho",
//     cron: "0 * * * *",
//     transform: (event) => ({ content: "...", meta: {...} }),
//   }))
//
//   await supervisor.start()

export {
  defineChannel,
  type Channel,
  type ChannelRuntime,
  type ChannelTransform,
  type ChannelBuildContext,
  type ChannelBroadcastPayload,
} from "@/engine/channel/channel"

export { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
export { timeChannel } from "@/engine/channel/time-channel"
export {
  createFileStatePersister,
  createChannelStatePersisterFactory,
} from "@/engine/channel/file-state-persister"
