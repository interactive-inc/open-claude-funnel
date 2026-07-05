// Channel manifest API — a thin layer that plugs flume sources into a
// `FlumeConfluence` and forwards events to a broadcast sink. Independent from
// the ConnectorDescriptor system (`@interactive-inc/claude-funnel/connectors/*`).
//
// Usage:
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
  type ChannelBroadcastSink,
} from "@/engine/channel/channel"

export { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
export { timeChannel } from "@/engine/channel/time-channel"
export { createFileStatePersister } from "@/engine/channel/file-state-persister"
export { createChannelStatePersisterFactory } from "@/engine/channel/channel-state-persister-factory"
