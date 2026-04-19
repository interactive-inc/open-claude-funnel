import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/gateway/start.help"

export const gatewayStartHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      "no-caffeine": z.string().optional(),
    }),
    help,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    if (funnel.gateway.isRunning()) {
      const status = funnel.gateway.getStatus()

      return c.text(`funnel gateway: already running (pid ${status.pid})`)
    }

    const started = await funnel.gateway.start({
      caffeinate: query["no-caffeine"] !== "true",
    })

    return started
      ? c.text("funnel gateway: started")
      : c.text("funnel gateway: failed to start", 500)
  },
)
