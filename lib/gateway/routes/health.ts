import { factory } from "@/gateway/factory"
import { withHttpErrorBoundary } from "@/gateway/routes/with-http-error-boundary"

/** GET /health — liveness + listener registry snapshot. */
export const healthHandler = factory.createHandlers((c) =>
  withHttpErrorBoundary(() => {
    const deps = c.var.deps

    return c.json({
      ok: true,
      clients: deps.broadcaster.getClientCount(),
      listeners: deps.registry.list(),
    })
  }),
)
