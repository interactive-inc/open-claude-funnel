import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

const stopHelp = `funnel gateway stop — stop the gateway

usage: funnel gateway stop

Terminates the process whose PID is stored in ~/.funnel/gateway.pid.

examples:
  funnel gateway stop`

export const gatewayStopHandler = factory.createHandlers(
  zValidator("query", z.object({}), stopHelp),
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
