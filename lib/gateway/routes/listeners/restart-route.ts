import { factory } from "@/gateway/factory";

/** POST /listeners/:name/restart — stop + start a connector listener. */
export const listenersRestartHandler = factory.createHandlers(async (c) => {
  const name = c.req.param("name");

  if (!name) return c.json({ ok: false, reason: "name required" }, 400);

  const result = await c.var.deps.supervisor.restart(name);

  return c.json(result, result.ok ? 200 : 400);
});
