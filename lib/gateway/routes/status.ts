import { factory } from "@/gateway/factory"
import { withHttpErrorBoundary } from "@/gateway/routes/with-http-error-boundary"

/** GET /status — listener registry, connected channels, and broadcaster metrics. */
export const statusHandler = factory.createHandlers((c) =>
  withHttpErrorBoundary(() => {
    const deps = c.var.deps

    return c.json({
      ok: true,
      uptimeMs: deps.uptimeMs(),
      clients: deps.broadcaster.listChannels(),
      listeners: deps.registry.list(),
      broadcaster: deps.broadcaster.getMetrics(),
    })
  }),
)
