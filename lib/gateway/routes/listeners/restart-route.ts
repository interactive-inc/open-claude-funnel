import { factory } from "@/gateway/factory"

/** POST /listeners/:channel/:connector/restart — stop + start a connector listener. */
export const listenersRestartHandler = factory.createHandlers(async (c) => {
  const channel = c.req.param("channel")
  const connector = c.req.param("connector")

  if (!channel || !connector) {
    return c.json({ ok: false, reason: "channel and connector required" }, 400)
  }

  const result = await c.var.deps.supervisor.restart(channel, connector)

  return c.json(result, result.ok ? 200 : 400)
})
