import type { Context } from "hono"
import { factory } from "@/cli/factory"
import type { Env } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { gatewayLoopbackUrl } from "@/engine/http/gateway-base-url"
import { renderYaml } from "@/engine/yaml/yaml-render"

const groupHelp = `funnel gateway / manage the funnel daemon

The gateway daemon hosts the WebSocket /ws (used by Claude MCP) and the
listener supervisor that runs every connector. One daemon, one port (9743
for the CLI, 9742 for programmatic use), one PID file.

usage / funnel gateway [subcommand]

subcommands:
  status / show running status (default)
  start / start in background
  stop / stop
  restart / stop then start
  run / start in foreground (for developers)
  logs [-n <N>] / tail the daemon diagnostic log
  sql / query inbound connector traffic
  listeners / list running connector listeners

output / valid YAML

see also / fnl doctor --fix (one command does diagnose + restart) / fnl debug --channel <name> (per-channel inspection)

programmable / funnel.gateway.start() / .stop() / .restart() / .getStatus() / funnel.doctor.run("safe")

examples:
  funnel gateway
  funnel gateway restart
  funnel gateway logs
  funnel gateway sql --preset recent`

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
  const funnel = c.env.funnel
  const status = funnel.gateway.getStatus()

  if (!status.running) {
    return c.text(renderYaml({ running: false }), 503)
  }

  const res = await fetch(`${gatewayLoopbackUrl(status.port)}/status`).catch(() => null)

  if (!res) {
    return c.text(
      renderYaml({
        running: true,
        pid: status.pid,
        port: status.port,
        error: "health check failed",
      }),
    )
  }

  const data = (await res.json()) as GatewayStatusResponse

  return c.text(
    renderYaml({
      running: true,
      pid: data.pid,
      port: status.port,
      uptimeMs: data.uptimeMs,
      events: data.broadcaster.eventsBroadcast,
      listeners: data.listeners.map((l) => ({
        channel: l.channelName,
        name: l.name,
        type: l.type,
        alive: l.alive,
        events: l.events,
        errors: l.errors,
        lastEventAt: l.lastEventAt,
      })),
      clients: data.clients.map((cl) => ({ channel: cl.channel, connectors: cl.connectors })),
    }),
  )
}

export const gatewayGroupHandler = factory.createHandlers(
  helpGuard(groupHelp),
  renderGatewayStatus,
)
