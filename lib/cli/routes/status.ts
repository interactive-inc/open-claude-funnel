import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import type { Funnel } from "@/funnel"
import type { FunnelProfiles } from "@/engine/profiles/profiles"

const statusHelp = `funnel status — overall health at a glance

usage: funnel status [--watch] [--interval <N>]

options:
  --watch               continuously refresh (Ctrl+C to stop)
  --interval <N>        polling interval in seconds (used with --watch, default: 3)

Shows gateway running state (pid, port, uptime), per-channel listener health
(● alive / ○ dead), and whether Claude is connected to each channel as a
WebSocket client. Use this as the first step when debugging missing events.

examples:
  funnel status
  funnel status --watch
  funnel status --watch --interval 5

see also: fnl debug --channel <name>  (per-channel diagnosis with next steps)`

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

const buildStatusLines = async (funnel: Funnel, profiles: FunnelProfiles): Promise<string[]> => {
  const channels = funnel.channels.list()
  const profileList = profiles.list()
  const gatewayStatus = funnel.gateway.getStatus()

  const lines: string[] = []

  lines.push("= funnel status =")
  lines.push("")

  let gatewayData: GatewayStatus | null = null

  if (!gatewayStatus.running) {
    lines.push("gateway: not running")
  } else {
    const res = await fetch(`http://127.0.0.1:${gatewayStatus.port}/status`).catch(() => null)

    let uptimeStr = ""

    if (res && res.ok) {
      const body: unknown = await res.json()

      if (isGatewayStatus(body)) {
        gatewayData = body

        const uptimeSec = Math.floor(body.uptimeMs / 1000)
        const uptimeMin = Math.floor(uptimeSec / 60)

        uptimeStr =
          uptimeMin >= 60
            ? ` · ${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}m`
            : uptimeSec >= 60
              ? ` · ${uptimeMin}m ${uptimeSec % 60}s`
              : ` · ${uptimeSec}s`
      }
    }

    lines.push(
      `gateway: running (pid ${gatewayStatus.pid}, port ${gatewayStatus.port})${uptimeStr}`,
    )
  }

  lines.push("")

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

  const maxNameLen = Math.max(...channels.map((ch) => ch.name.length), 0)

  lines.push(`channels: ${channels.length}`)

  for (const ch of channels) {
    const connectorLabel =
      ch.connectors.length > 0 ? ch.connectors.map((conn) => conn.type).join(", ") : "no connectors"

    const isAlive = listenerAliveByChannel.get(ch.name)
    const indicator =
      gatewayData === null ? "-" : isAlive === true ? "●" : isAlive === false ? "○" : "-"

    const claudeCount = clientsByChannel.get(ch.name) ?? 0
    const claudeLabel =
      gatewayData === null
        ? ""
        : claudeCount === 0
          ? "  no Claude"
          : claudeCount === 1
            ? "  Claude connected (1 client)"
            : `  Claude connected (${claudeCount} clients)`

    const paddedName = ch.name.padEnd(maxNameLen)

    lines.push(`  ${indicator} ${paddedName}  [${connectorLabel}]${claudeLabel}`)
  }

  lines.push("")

  lines.push(`profiles: ${profileList.length}`)

  for (const [index, profile] of profileList.entries()) {
    const tag = index === 0 ? " (default)" : ""
    const channel = funnel.channels.getById(profile.channelId)
    const channelLabel = channel ? channel.name : `id:${profile.channelId}`

    lines.push(`  - ${profile.name}${tag} [path=${profile.path}, channel=${channelLabel}]`)
  }

  return lines
}

export const statusHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      watch: z.enum(["true", "false", ""]).optional(),
      interval: z.string().optional(),
    }),
    statusHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const isWatch = query.watch === "true" || query.watch === ""
    const intervalSec = Math.min(60, Math.max(1, query.interval ? Number(query.interval) : 3))

    if (!isWatch) {
      const lines = await buildStatusLines(funnel, c.env.profiles)

      return c.text(lines.join("\n"))
    }

    const render = async () => {
      const lines = await buildStatusLines(funnel, c.env.profiles)
      const ts = new Date().toISOString().slice(11, 19)

      process.stdout.write("\x1b[2J\x1b[H")
      process.stdout.write(lines.join("\n"))
      process.stdout.write(`\n\n  refreshing every ${intervalSec}s · ${ts} · Ctrl+C to stop\n`)
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
