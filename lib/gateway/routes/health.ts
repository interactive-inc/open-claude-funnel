import { factory } from "@/gateway/factory"

/** GET /health — liveness + listener registry snapshot. */
export const healthHandler = factory.createHandlers((c) => {
  const deps = c.var.deps

  return c.json({
    ok: true,
    clients: deps.broadcaster.getClientCount(),
    listeners: deps.registry.list(),
  })
})
