import { factory } from "@/gateway/factory"
import { withHttpErrorBoundary } from "@/gateway/routes/with-http-error-boundary"

/** GET /listeners — running connector listeners with alive/dead status. */
export const listenersListHandler = factory.createHandlers((c) =>
  withHttpErrorBoundary(() => {
    return c.json({ listeners: c.var.deps.registry.list() })
  }),
)
