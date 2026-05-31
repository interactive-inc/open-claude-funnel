import { join } from "node:path"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"

export const startHelp = `funnel gateway start — start the gateway in background

usage: funnel gateway start [--no-caffeine]

Spawned as a detached background process so it keeps running after the terminal is closed.
On macOS wraps the process with caffeinate -is by default to prevent idle and system sleep.
Use --no-caffeine to disable caffeinate.

port: 9743 (CLI default; override via FUNNEL_PORT)
pid:  ~/.funnel/gateway.pid
log:  ${join(funnelTmpDir(), "gateway.log")}

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
