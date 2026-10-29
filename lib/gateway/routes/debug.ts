import { factory } from "@/gateway/factory"
import { withHttpErrorBoundary } from "@/gateway/routes/with-http-error-boundary"
import { requireSynchronous } from "@/require-synchronous"
import { normalizeError } from "@/engine/error/error-message-of"

/** Read connection facts and optional history. Interpretation belongs to the host. */
export const debugHandler = factory.createHandlers((c) =>
  withHttpErrorBoundary(() => {
    const deps = c.var.deps
    const filter = c.req.query("channel")
    const listeners = deps.registry.list()
    const clients = deps.broadcaster.listChannels()
    const reportQueryError = (query: string, channelId: string) => (error: unknown) =>
      deps.onError?.(normalizeError(error), {
        component: "gateway.diagnostic-query",
        query,
        channelId,
      })
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
          recentEvents: requireSynchronous(
            deps.diagnosticLog?.queryProcessed({ channelId: channel.id, limit: 10 }) ?? [],
            "diagnostic queryProcessed must be synchronous",
            reportQueryError("queryProcessed", channel.id),
          ),
          connections: requireSynchronous(
            deps.diagnosticLog?.queryConnection({ channelId: channel.id, limit: 10 }) ?? [],
            "diagnostic queryConnection must be synchronous",
            reportQueryError("queryConnection", channel.id),
          ),
        })),
    })
  }),
)
