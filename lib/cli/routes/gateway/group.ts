import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/gateway/group.help"

export const gatewayGroupHandler = factory.createHandlers(
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

    const health: unknown = await res.json()
    const clients =
      health !== null && typeof health === "object" && "clients" in health ? health.clients : 0

    return c.text(
      `funnel gateway: running (pid ${status.pid})\n  port: ${status.port}\n  clients: ${clients ?? 0}`,
    )
  },
)
