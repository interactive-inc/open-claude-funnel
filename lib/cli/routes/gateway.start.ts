import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const startHelp = `funnel gateway start — start the gateway in background

usage: funnel gateway start [--no-caffeine]

Daemonized with nohup, so it keeps running after the terminal is closed.
On macOS wraps the process with caffeinate -is by default to prevent idle and system sleep.
Use --no-caffeine to disable caffeinate.

port: 9742 (override via FUNNEL_PORT)
pid:  ~/.funnel/gateway.pid
log:  /tmp/funnel/gateway.log

examples:
  funnel gateway start
  funnel gateway start --no-caffeine`

export const gatewayStartHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      "no-caffeine": z.string().optional(),
    }),
    startHelp,
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

    if (!started) {
      throw new HTTPException(500, { message: "funnel gateway: failed to start" })
    }

    return c.text("funnel gateway: started")
  },
)
