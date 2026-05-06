import { factory } from "@/gateway/factory";

/** DELETE /listeners/:name — stop a connector listener by name. */
export const listenersStopHandler = factory.createHandlers(async (c) => {
  const name = c.req.param("name");

  if (!name) return c.json({ ok: false, reason: "name required" }, 400);

  const result = await c.var.deps.supervisor.stop(name);

  return c.json(result, result.ok ? 200 : 400);
});
