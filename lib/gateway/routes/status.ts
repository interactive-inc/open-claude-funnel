import { factory } from "@/gateway/factory"

/** GET /status — listener registry, connected channels, and broadcaster metrics. */
export const statusHandler = factory.createHandlers((c) => {
  const deps = c.var.deps

  return c.json({
    ok: true,
    uptimeMs: deps.uptimeMs(),
    clients: deps.broadcaster.listChannels(),
    listeners: deps.registry.list(),
    broadcaster: deps.broadcaster.getMetrics(),
  })
})
