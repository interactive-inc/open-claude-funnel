import { factory } from "@/gateway/factory";

/** POST /listeners/:name/start — start a connector listener by name. */
export const listenersStartHandler = factory.createHandlers(async (c) => {
  const name = c.req.param("name");

  if (!name) return c.json({ ok: false, reason: "name required" }, 400);

  const result = await c.var.deps.supervisor.start(name);

  return c.json(result, result.ok ? 200 : 400);
});
