import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/gateway/stop.help"

export const gatewayStopHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  async (c) => {
    const funnel = c.var.funnel

    if (!funnel.gateway.isRunning()) {
      return c.text("funnel gateway: no running process")
    }

    const stopped = await funnel.gateway.stop()

    return stopped
      ? c.text("funnel gateway: stopped")
      : c.text("funnel gateway: failed to stop", 500)
  },
)
