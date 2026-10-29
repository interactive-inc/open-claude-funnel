import { z } from "zod"
import { factory } from "@/gateway/factory"
import { zParam } from "@/gateway/routes/validator"
import { withHttpErrorBoundary } from "@/gateway/routes/with-http-error-boundary"

/** POST /listeners/:channel/:connector/restart — stop + start a connector listener. */
export const listenersRestartHandler = factory.createHandlers(
  zParam(z.object({ channel: z.string().min(1), connector: z.string().min(1) })),
  (c) =>
    withHttpErrorBoundary(async () => {
      const param = c.req.valid("param")

      c.var.deps.assertActive()
      const result = await c.var.deps.registry.restart(param.channel, param.connector)

      return c.json(result, result.ok ? 200 : 400)
    }),
)
