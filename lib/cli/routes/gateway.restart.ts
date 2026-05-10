import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const restartHelp = `funnel gateway restart — restart the gateway

usage: funnel gateway restart [--no-caffeine]

Stops the running process then starts it again in background.
On macOS wraps with caffeinate -i by default. Use --no-caffeine to disable.

examples:
  funnel gateway restart
  funnel gateway restart --no-caffeine`

export const gatewayRestartHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      "no-caffeine": z.string().optional(),
    }),
    restartHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const result = await funnel.gateway.restart({
      caffeinate: query["no-caffeine"] !== "true",
    })
    const lines: string[] = []

    if (result.wasRunning) {
      lines.push(result.stopped ? "funnel gateway: stopped" : "funnel gateway: failed to stop")
    }

    if (result.stopped) {
      lines.push(result.started ? "funnel gateway: started" : "funnel gateway: failed to start")
    }

    const body = lines.join("\n")

    if (!result.ok) {
      throw new HTTPException(500, { message: body })
    }

    return c.text(body)
  },
)
