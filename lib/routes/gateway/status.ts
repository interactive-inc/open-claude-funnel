import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/gateway/status.help"

export const gatewayStatusHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  async (c) => {
    const funnel = c.var.funnel
    const status = funnel.gateway.getStatus()

    if (!status.running) {
      return c.text("funnel gateway: not running", 503)
    }

    const res = await fetch(`http://localhost:${status.port}/health`).catch(() => null)

    if (!res) {
      return c.text(`funnel gateway: running (pid ${status.pid}) — health check failed`)
    }

    const health = (await res.json()) as Record<string, unknown>

    return c.text(
      `funnel gateway: running (pid ${status.pid})\n  port: ${status.port}\n  clients: ${health.clients ?? 0}`,
    )
  },
)
