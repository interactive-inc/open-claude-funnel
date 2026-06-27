import { factory } from "@/gateway/factory"

/** GET /health — liveness + listener registry snapshot. */
export const healthHandler = factory.createHandlers((c) => {
  const deps = c.var.deps

  return c.json({
    ok: true,
    pid: deps.selfPid,
    funnelDir: deps.dir,
    clients: deps.broadcaster.getClientCount(),
    listeners: deps.registry.list(),
  })
})
