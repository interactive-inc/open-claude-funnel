import { z } from "zod"
import { factory } from "@/gateway/factory"
import { zParam } from "@/gateway/routes/validator"

/** POST /listeners/:channel/:connector/start — start a connector listener. */
export const listenersStartHandler = factory.createHandlers(
  zParam(z.object({ channel: z.string().min(1), connector: z.string().min(1) })),
  async (c) => {
    const param = c.req.valid("param")

    const result = await c.var.deps.supervisor.start(param.channel, param.connector)

    return c.json(result, result.ok ? 200 : 400)
  },
)
