import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { renderGatewayStatus } from "@/cli/routes/gateway"

const statusHelp = `funnel gateway status — show gateway running status

usage: funnel gateway status [--json]

options:
  --json   output as JSON

When running, prints PID, port, uptime, listeners (alive/dead), and WS clients.
When not running, exits with 503.

examples:
  funnel gateway status
  funnel gateway status --json`

export const gatewayStatusHandler = factory.createHandlers(
  zValidator("query", z.object({ json: z.enum(["true", "false", ""]).optional() }), statusHelp),
  async (c) => {
    const query = c.req.valid("query")
    const isJson = query.json === "true" || query.json === ""

    if (!isJson) return renderGatewayStatus(c)

    const funnel = c.env.funnel
    const status = funnel.gateway.getStatus()

    if (!status.running) {
      throw new HTTPException(503, { message: "funnel gateway: not running" })
    }

    const res = await fetch(`http://127.0.0.1:${status.port}/status`).catch(() => null)

    if (!res) {
      return c.json({
        running: true,
        pid: status.pid,
        port: status.port,
        error: "health check failed",
      })
    }

    const data = await res.json()

    return c.json({ running: true, port: status.port, ...(data as Record<string, unknown>) })
  },
)
