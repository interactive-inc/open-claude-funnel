import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/gateway/restart.help"

export const gatewayRestartHandler = factory.createHandlers(
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

    return result.ok ? c.text(body) : c.text(body, 500)
  },
)
