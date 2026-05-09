import { factory } from "@/gateway/factory"

/** GET /listeners — running connector listeners with alive/dead status. */
export const listenersListHandler = factory.createHandlers((c) => {
  return c.json({ listeners: c.var.deps.supervisor.list() })
})
