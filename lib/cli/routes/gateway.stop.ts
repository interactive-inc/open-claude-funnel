import { HTTPException } from "hono/http-exception"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"

const stopHelp = `funnel gateway stop — stop the gateway

usage: funnel gateway stop

Terminates the process whose PID is stored in ~/.funnel/gateway.pid.

examples:
  funnel gateway stop`

export const gatewayStopHandler = factory.createHandlers(
  helpGuard(stopHelp),
  async (c) => {
    const funnel = c.env.funnel

    if (!funnel.gateway.isRunning()) {
      return c.text("funnel gateway: no running process")
    }

    const stopped = await funnel.gateway.stop()

    if (!stopped) {
      throw new HTTPException(500, { message: "funnel gateway: failed to stop" })
    }

    return c.text("funnel gateway: stopped")
  },
)
