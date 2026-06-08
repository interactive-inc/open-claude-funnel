import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/cli/yaml-render"
import type { Funnel } from "@/funnel"
import type { FunnelProfiles } from "@/engine/profiles/profiles"

const statusHelp = `funnel status / overall health snapshot

usage / funnel status [--watch] [--interval <N>]

options:
  --watch / continuously refresh (Ctrl+C to stop)
  --interval <N> / polling interval in seconds (default 3)

output / valid YAML

For a richer diagnosis with rootCause + nextActions, prefer fnl doctor.

programmable / funnel.gateway.getStatus() / funnel.doctor.run()

examples:
  funnel status
  funnel status --watch
  funnel status --watch --interval 5`

type GatewayClient = {
  channel: string
  channelName: string | null
  connectors: string[]
}

type ListenerStatus = {
  channelName: string
  name: string
  type: string
  alive: boolean
}

type GatewayStatus = {
  ok: boolean
  uptimeMs: number
  clients: GatewayClient[]
  listeners: ListenerStatus[]
}

const isGatewayStatus = (value: unknown): value is GatewayStatus => {
  if (value === null || typeof value !== "object") return false
  if (!("clients" in value) || !Array.isArray(value.clients)) return false
  if (!("listeners" in value) || !Array.isArray(value.listeners)) return false

  return true
}

const buildStatusReport = async (funnel: Funnel, profiles: FunnelProfiles) => {
  const channels = funnel.channels.list()
  const profileList = profiles.list()
  const gatewayStatus = funnel.gateway.getStatus()

  let gatewayData: GatewayStatus | null = null

  if (gatewayStatus.running) {
    const res = await fetch(`http://127.0.0.1:${gatewayStatus.port}/status`).catch(() => null)

    if (res && res.ok) {
      const body: unknown = await res.json()

      if (isGatewayStatus(body)) gatewayData = body
    }
  }

  const clientsByChannel = new Map<string, number>()
  const listenerAliveByChannel = new Map<string, boolean>()

  if (gatewayData) {
    for (const client of gatewayData.clients) {
      const key = client.channelName ?? client.channel
      clientsByChannel.set(key, (clientsByChannel.get(key) ?? 0) + 1)
    }

    for (const listener of gatewayData.listeners) {
      const current = listenerAliveByChannel.get(listener.channelName)

      listenerAliveByChannel.set(
        listener.channelName,
        current === undefined ? listener.alive : current && listener.alive,
      )
    }
  }

  return {
    gateway: gatewayStatus.running
      ? {
          running: true,
          pid: gatewayStatus.pid,
          port: gatewayStatus.port,
          uptimeMs: gatewayData?.uptimeMs ?? null,
        }
      : { running: false },
    channels: channels.map((ch) => ({
      name: ch.name,
      connectors: ch.connectors.map((conn) => ({ name: conn.name, type: conn.type })),
      listenerAlive: gatewayData === null ? null : (listenerAliveByChannel.get(ch.name) ?? null),
      claudeClients: clientsByChannel.get(ch.name) ?? 0,
    })),
    profiles: profileList.map((profile, index) => {
      const channel = funnel.channels.getById(profile.channelId)

      return {
        name: profile.name,
        default: index === 0,
        path: profile.path,
        channel: channel ? channel.name : null,
        channelId: channel ? undefined : profile.channelId,
      }
    }),
  }
}

export const statusHandler = factory.createHandlers(
  helpGuard(statusHelp),
  zValidator(
    "query",
    z.object({
      watch: z.enum(["true", "false", ""]).optional(),
      interval: z.string().optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const isWatch = query.watch === "true" || query.watch === ""
    const intervalSec = Math.min(60, Math.max(1, query.interval ? Number(query.interval) : 3))

    if (!isWatch) {
      const report = await buildStatusReport(funnel, c.env.profiles)

      return c.text(renderYaml(report))
    }

    const render = async () => {
      const report = await buildStatusReport(funnel, c.env.profiles)

      process.stdout.write("\x1b[2J\x1b[H")
      process.stdout.write(renderYaml(report))
      process.stdout.write(`\n# refreshing every ${intervalSec}s; Ctrl+C to stop\n`)
    }

    process.on("SIGINT", () => {
      process.stdout.write("\n")
      process.exit(0)
    })

    await render()

    const timer = setInterval(render, intervalSec * 1000)

    await new Promise<void>(() => {
      process.on("exit", () => clearInterval(timer))
    })

    return c.text("")
  },
)
