import { HTTPException } from "hono/http-exception"
import type { Context } from "hono"
import { z } from "zod"
import { factory } from "@/cli/factory"
import type { Env } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const groupHelp = `funnel gateway — manage the funnel daemon

The gateway daemon hosts the WebSocket /ws (used by Claude MCP) and the
listener supervisor that runs every connector. One daemon, one port (9743
for the CLI, 9742 for programmatic use), one PID file.

usage: funnel gateway [subcommand]

subcommands:
  status              show running status (default)
  start               start in background
  stop                stop
  restart             stop then start
  run                 start in foreground (for developers)
  logs [-n <N>]       tail the daemon diagnostic log (lifecycle, listener boot)
  sql                 query inbound connector traffic (raw + processed verdict)
  listeners           list running connector listeners (alive / dead)

examples:
  funnel gateway                    check status
  funnel gateway restart            restart after config changes
  funnel gateway logs               stream the daemon log
  funnel gateway sql --preset recent  inspect last 20 inbound events

see also: fnl debug --channel <name>  (higher-level diagnosis with next-action hints)`

type ListenerStatus = {
  channelName: string
  name: string
  type: string
  alive: boolean
  events: number
  errors: number
  lastEventAt: string | null
}

type ChannelClient = {
  channel: string
  connectors: string[]
}

type GatewayStatusResponse = {
  pid: number
  uptimeMs: number
  clients: ChannelClient[]
  listeners: ListenerStatus[]
  broadcaster: {
    clients: number
    eventsBroadcast: number
    droppedSlowClients: number
    latestOffset: number
  }
}

export const renderGatewayStatus = async (c: Context<Env>) => {
  const funnel = c.var.funnel
  const status = funnel.gateway.getStatus()

  if (!status.running) {
    throw new HTTPException(503, { message: "funnel gateway: not running" })
  }

  const res = await fetch(`http://127.0.0.1:${status.port}/status`).catch(() => null)

  if (!res) {
    return c.text(`funnel gateway: running (pid ${status.pid}) — health check failed`)
  }

  const data = (await res.json()) as GatewayStatusResponse

  const lines: string[] = []

  lines.push(`funnel gateway: running (pid ${data.pid})`)
  lines.push(`  port:   ${status.port}`)

  const uptimeSec = Math.floor(data.uptimeMs / 1000)
  const uptimeMin = Math.floor(uptimeSec / 60)
  const uptimeStr =
    uptimeMin >= 60
      ? `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}m`
      : uptimeSec >= 60
        ? `${uptimeMin}m ${uptimeSec % 60}s`
        : `${uptimeSec}s`
  lines.push(`  uptime: ${uptimeStr}`)

  lines.push(`  events: ${data.broadcaster.eventsBroadcast} broadcast`)

  if (data.listeners.length === 0) {
    lines.push(`  listeners: none`)
  } else {
    lines.push(`  listeners:`)
    for (const l of data.listeners) {
      const indicator = l.alive ? "●" : "○"
      const eventsStr = l.events > 0 ? ` (${l.events} events)` : ""
      const errStr = l.errors > 0 ? ` ⚠ ${l.errors} errors` : ""
      lines.push(`    ${indicator} ${l.channelName}/${l.name} [${l.type}]${eventsStr}${errStr}`)
    }
  }

  if (data.clients.length === 0) {
    lines.push(`  clients: none`)
  } else {
    lines.push(`  clients: ${data.clients.length}`)
    for (const cl of data.clients) {
      const connectors = cl.connectors.length > 0 ? ` → ${cl.connectors.join(", ")}` : ""
      lines.push(`    · ${cl.channel}${connectors}`)
    }
  }

  return c.text(lines.join("\n"))
}

export const gatewayGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), groupHelp),
  renderGatewayStatus,
)
