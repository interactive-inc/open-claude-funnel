import { HTTPException } from "hono/http-exception"
import type { Context } from "hono"
import { z } from "zod"
import { factory } from "@/cli/factory"
import type { Env } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const groupHelp = `funnel gateway — manage the funnel daemon

The gateway daemon hosts the WebSocket /ws (used by Claude MCP), the
local web UI at /, and the listener supervisor that runs every
connector. One daemon, one port (9742), one PID file.

usage: funnel gateway [subcommand]

subcommands:
  status              show running status (default)
  start               start in background
  stop                stop
  restart             stop then start
  run                 start in foreground (for developers)
  logs [-n <N>]       show event logs
  listeners           list running connector listeners (alive / dead)

examples:
  funnel gateway                check status
  funnel gateway restart        restart`

export const renderGatewayStatus = async (c: Context<Env>) => {
  const funnel = c.var.funnel
  const status = funnel.gateway.getStatus()

  if (!status.running) {
    throw new HTTPException(503, { message: "funnel gateway: not running" })
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
}

export const gatewayGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), groupHelp),
  renderGatewayStatus,
)
