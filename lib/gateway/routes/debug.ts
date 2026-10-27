import { factory } from "@/gateway/factory"

/** Read connection facts and optional history. Interpretation belongs to the host. */
export const debugHandler = factory.createHandlers((c) => {
  const deps = c.var.deps
  const filter = c.req.query("channel")
  const listeners = deps.registry.list()
  const clients = deps.broadcaster.listChannels()
  return c.json({
    uptimeMs: deps.uptimeMs(),
    broadcaster: deps.broadcaster.getMetrics(),
    diagnosticsEnabled: deps.diagnosticLog !== undefined,
    channels: deps.channels
      .list()
      .filter((channel) => !filter || filter === channel.id || filter === channel.name)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        connectors: channel.connectors.map((connector) => connector.name),
        listeners: listeners.filter((listener) => listener.channelId === channel.id),
        subscribers: clients.filter((client) => client.channel === channel.id).length,
        recentEvents:
          deps.diagnosticLog?.queryProcessed({ channelId: channel.id, limit: 10 }) ?? [],
        connections:
          deps.diagnosticLog?.queryConnection({ channelId: channel.id, limit: 10 }) ?? [],
      })),
  })
})
